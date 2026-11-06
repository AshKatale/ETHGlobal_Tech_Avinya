// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgreementFactory} from "../src/AgreementFactory.sol";
import {JobEscrow} from "../src/JobEscrow.sol";

contract JobEscrowTest is Test {
    AgreementFactory factory;
    uint256 verifierKey = 0xA11CE;
    address verifier;
    address operator = address(0x0BE);
    address client = address(0xC11E);
    address payable agent = payable(address(0xA6E));
    address payable subAgent = payable(address(0x5AB));
    uint256 constant PRICE = 10 * 1e8; // 10 HBAR in tinybar
    bytes32 constant AID = keccak256("agreement-1");
    JobEscrow escrow;

    function setUp() public {
        verifier = vm.addr(verifierKey);
        vm.prank(operator);
        factory = new AgreementFactory(verifier);
        vm.prank(operator);
        escrow = JobEscrow(payable(factory.createEscrow(AID, client, agent, PRICE, uint64(block.timestamp + 1 days))));
        vm.deal(client, 100 ether);
    }

    function _sign(bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(verifierKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _verdictSig(uint8 result, uint256 nonce) internal view returns (bytes memory) {
        return _sign(keccak256(abi.encode(
            keccak256("Verdict(bytes32 agreementId,uint8 result,uint256 nonce)"), AID, result, nonce)));
    }

    function _delegationSig(address sub, uint256 amount, uint256 nonce) internal view returns (bytes memory) {
        return _sign(keccak256(abi.encode(
            keccak256("Delegation(bytes32 agreementId,address subAgent,uint256 amount,uint256 nonce)"), AID, sub, amount, nonce)));
    }

    function _fundAndSubmit() internal {
        vm.prank(client);
        escrow.fund{value: PRICE}();
        vm.prank(agent);
        escrow.submit(keccak256("work"));
    }

    function test_factoryOnlyOwnerAndUnique() public {
        vm.expectRevert(AgreementFactory.NotOwner.selector);
        factory.createEscrow(keccak256("x"), client, agent, PRICE, 0);
        vm.prank(operator);
        vm.expectRevert(AgreementFactory.AlreadyExists.selector);
        factory.createEscrow(AID, client, agent, PRICE, 0);
        assertEq(factory.escrowOf(AID), address(escrow));
    }

    function test_twoEscrowsAreIndependent() public {
        vm.prank(operator);
        JobEscrow other = JobEscrow(payable(factory.createEscrow(keccak256("agreement-2"), client, agent, 5 * 1e8, uint64(block.timestamp + 1 days))));
        vm.prank(client);
        escrow.fund{value: PRICE}();
        assertEq(address(escrow).balance, PRICE);
        assertEq(address(other).balance, 0);
        assertEq(uint8(other.state()), uint8(JobEscrow.State.Created));
    }

    function test_happyPath_release() public {
        _fundAndSubmit();
        uint256 before = agent.balance;
        escrow.release(1, _verdictSig(escrow.PASS(), 1));
        assertEq(agent.balance - before, PRICE);
        assertEq(address(escrow).balance, 0);
        assertEq(uint8(escrow.state()), uint8(JobEscrow.State.Released));
    }

    function test_fail_refund() public {
        _fundAndSubmit();
        uint256 before = client.balance;
        escrow.refund(7, _verdictSig(escrow.FAIL(), 7));
        assertEq(client.balance - before, PRICE);
        assertEq(uint8(escrow.state()), uint8(JobEscrow.State.Refunded));
    }

    function test_passSignatureCannotRefund_andFailCannotRelease() public {
        _fundAndSubmit();
        bytes memory passSig = _verdictSig(1, 1);
        bytes memory failSig = _verdictSig(0, 2);
        vm.expectRevert(JobEscrow.BadSignature.selector);
        escrow.refund(1, passSig);
        vm.expectRevert(JobEscrow.BadSignature.selector);
        escrow.release(2, failSig);
    }

    function test_wrongAmountAndWrongSenderRevert() public {
        vm.prank(client);
        vm.expectRevert(JobEscrow.WrongAmount.selector);
        escrow.fund{value: PRICE - 1}();
        vm.deal(address(0xBAD), 100 ether);
        vm.prank(address(0xBAD));
        vm.expectRevert(JobEscrow.NotAllowed.selector);
        escrow.fund{value: PRICE}();
        // submit before funding
        vm.prank(agent);
        vm.expectRevert(JobEscrow.WrongState.selector);
        escrow.submit(bytes32(0));
    }

    function test_onlyAgentOrOperatorCanSubmit() public {
        vm.prank(client);
        escrow.fund{value: PRICE}();
        vm.prank(address(0xBAD));
        vm.expectRevert(JobEscrow.NotAllowed.selector);
        escrow.submit(bytes32(0));
        vm.prank(operator);
        escrow.submit(keccak256("work"));
    }

    function test_replayedSignatureReverts() public {
        _fundAndSubmit();
        bytes memory sig = _verdictSig(escrow.PASS(), 9);
        escrow.release(9, sig);
        vm.expectRevert(JobEscrow.WrongState.selector);
        escrow.release(9, sig);
    }

    function test_signatureFromAnotherEscrowIsRejected() public {
        vm.prank(operator);
        JobEscrow other = JobEscrow(payable(factory.createEscrow(keccak256("agreement-2"), client, agent, PRICE, uint64(block.timestamp + 1 days))));
        vm.prank(client);
        other.fund{value: PRICE}();
        vm.prank(agent);
        other.submit(bytes32(0));
        _fundAndSubmit();
        // signature minted for `escrow` must not release `other` (different verifyingContract and agreementId)
        bytes memory sig = _verdictSig(escrow.PASS(), 3);
        vm.expectRevert(JobEscrow.BadSignature.selector);
        other.release(3, sig);
    }

    function test_deadlineRefund() public {
        vm.prank(client);
        escrow.fund{value: PRICE}();
        vm.expectRevert(JobEscrow.TooEarly.selector);
        escrow.refundAfterDeadline();
        vm.warp(block.timestamp + 1 days + 1);
        uint256 before = client.balance;
        escrow.refundAfterDeadline();
        assertEq(client.balance - before, PRICE);
    }

    function test_delegate_thenReleaseRemainder() public {
        _fundAndSubmit();
        uint256 amt = 3 * 1e8;
        bytes memory dsig = _delegationSig(subAgent, amt, 11);
        vm.prank(operator);
        escrow.delegate(subAgent, amt, 11, dsig);
        assertEq(subAgent.balance, amt);
        assertEq(escrow.delegated(), amt);
        bytes memory rsig = _verdictSig(1, 12);
        escrow.release(12, rsig);
        assertEq(agent.balance, PRICE - amt);
        assertEq(address(escrow).balance, 0);
    }

    function test_delegateGuards() public {
        vm.prank(client);
        escrow.fund{value: PRICE}();
        uint256 amt = 1e8;
        bytes memory okSig = _delegationSig(subAgent, amt, 1);
        bytes memory wrongAmountSig = _delegationSig(subAgent, amt + 1, 1);
        bytes memory tooMuchSig = _delegationSig(subAgent, PRICE + 1, 2);
        bytes memory nonce3Sig = _delegationSig(subAgent, amt, 3);
        // only operator
        vm.expectRevert(JobEscrow.NotAllowed.selector);
        escrow.delegate(subAgent, amt, 1, okSig);
        // signature for a different amount
        vm.prank(operator);
        vm.expectRevert(JobEscrow.BadSignature.selector);
        escrow.delegate(subAgent, amt, 1, wrongAmountSig);
        // more than the escrow holds
        vm.prank(operator);
        vm.expectRevert(JobEscrow.WrongAmount.selector);
        escrow.delegate(subAgent, PRICE + 1, 2, tooMuchSig);
        // nonce reuse
        vm.prank(operator);
        escrow.delegate(subAgent, amt, 3, nonce3Sig);
        vm.prank(operator);
        vm.expectRevert(JobEscrow.NonceUsed.selector);
        escrow.delegate(subAgent, amt, 3, nonce3Sig);
    }

    function test_refundAfterDelegationReturnsRemainder() public {
        _fundAndSubmit();
        uint256 amt = 2 * 1e8;
        bytes memory dsig = _delegationSig(subAgent, amt, 21);
        bytes memory vsig = _verdictSig(0, 22);
        vm.prank(operator);
        escrow.delegate(subAgent, amt, 21, dsig);
        uint256 before = client.balance;
        escrow.refund(22, vsig);
        assertEq(client.balance - before, PRICE - amt);
    }
}
