// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {AgreementFactoryV2} from "../src/AgreementFactoryV2.sol";
import {JobEscrowV2} from "../src/JobEscrowV2.sol";

contract JobEscrowV2Test is Test {
    AgreementFactoryV2 factory;
    uint256 verifierKey = 0xA11CE;
    address verifier;
    address operator = address(0x0BE);
    address client = address(0xC11E);
    address payable agent = payable(address(0xA6E));
    address payable subAgent = payable(address(0x5AB));
    uint256 constant PRICE = 10 * 1e8; // 10 HBAR in tinybar
    bytes32 constant AID = keccak256("agreement-1");
    JobEscrowV2 escrow;

    function setUp() public {
        verifier = vm.addr(verifierKey);
        vm.prank(operator);
        factory = new AgreementFactoryV2(verifier);
        vm.prank(operator);
        escrow = JobEscrowV2(payable(factory.createEscrow(AID, client, agent, PRICE, uint64(block.timestamp + 1 days))));
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
        vm.expectRevert(AgreementFactoryV2.NotOwner.selector);
        factory.createEscrow(keccak256("x"), client, agent, PRICE, uint64(block.timestamp + 1 days));
        vm.prank(operator);
        vm.expectRevert(AgreementFactoryV2.AlreadyExists.selector);
        factory.createEscrow(AID, client, agent, PRICE, uint64(block.timestamp + 1 days));
        assertEq(factory.escrowOf(AID), address(escrow));
    }

    function test_twoEscrowsAreIndependent() public {
        vm.prank(operator);
        JobEscrowV2 other = JobEscrowV2(payable(factory.createEscrow(keccak256("agreement-2"), client, agent, 5 * 1e8, uint64(block.timestamp + 1 days))));
        vm.prank(client);
        escrow.fund{value: PRICE}();
        assertEq(address(escrow).balance, PRICE);
        assertEq(address(other).balance, 0);
        assertEq(uint8(other.state()), uint8(JobEscrowV2.State.Created));
    }

    function test_happyPath_release() public {
        _fundAndSubmit();
        uint256 before = agent.balance;
        escrow.release(1, _verdictSig(escrow.PASS(), 1));
        assertEq(agent.balance - before, PRICE);
        assertEq(address(escrow).balance, 0);
        assertEq(uint8(escrow.state()), uint8(JobEscrowV2.State.Released));
    }

    function test_fail_refund() public {
        _fundAndSubmit();
        uint256 before = client.balance;
        escrow.refund(7, _verdictSig(escrow.FAIL(), 7));
        assertEq(client.balance - before, PRICE);
        assertEq(uint8(escrow.state()), uint8(JobEscrowV2.State.Refunded));
    }

    function test_passSignatureCannotRefund_andFailCannotRelease() public {
        _fundAndSubmit();
        bytes memory passSig = _verdictSig(1, 1);
        bytes memory failSig = _verdictSig(0, 2);
        vm.expectRevert(JobEscrowV2.BadSignature.selector);
        escrow.refund(1, passSig);
        vm.expectRevert(JobEscrowV2.BadSignature.selector);
        escrow.release(2, failSig);
    }

    function test_wrongAmountAndWrongSenderRevert() public {
        vm.prank(client);
        vm.expectRevert(JobEscrowV2.WrongAmount.selector);
        escrow.fund{value: PRICE - 1}();
        vm.deal(address(0xBAD), 100 ether);
        vm.prank(address(0xBAD));
        vm.expectRevert(JobEscrowV2.NotAllowed.selector);
        escrow.fund{value: PRICE}();
        // submit before funding
        vm.prank(agent);
        vm.expectRevert(JobEscrowV2.WrongState.selector);
        escrow.submit(bytes32(0));
    }

    function test_onlyAgentOrOperatorCanSubmit() public {
        vm.prank(client);
        escrow.fund{value: PRICE}();
        vm.prank(address(0xBAD));
        vm.expectRevert(JobEscrowV2.NotAllowed.selector);
        escrow.submit(bytes32(0));
        vm.prank(operator);
        escrow.submit(keccak256("work"));
    }

    function test_replayedSignatureReverts() public {
        _fundAndSubmit();
        bytes memory sig = _verdictSig(escrow.PASS(), 9);
        escrow.release(9, sig);
        vm.expectRevert(JobEscrowV2.WrongState.selector);
        escrow.release(9, sig);
    }

    function test_signatureFromAnotherEscrowIsRejected() public {
        vm.prank(operator);
        JobEscrowV2 other = JobEscrowV2(payable(factory.createEscrow(keccak256("agreement-2"), client, agent, PRICE, uint64(block.timestamp + 1 days))));
        vm.prank(client);
        other.fund{value: PRICE}();
        vm.prank(agent);
        other.submit(bytes32(0));
        _fundAndSubmit();
        // signature minted for `escrow` must not release `other` (different verifyingContract and agreementId)
        bytes memory sig = _verdictSig(escrow.PASS(), 3);
        vm.expectRevert(JobEscrowV2.BadSignature.selector);
        other.release(3, sig);
    }

    function test_deadlineRefund() public {
        vm.prank(client);
        escrow.fund{value: PRICE}();
        vm.expectRevert(JobEscrowV2.TooEarly.selector);
        escrow.refundAfterDeadline();
        vm.warp(block.timestamp + 1 days + 1);
        uint256 before = client.balance;
        escrow.refundAfterDeadline();
        assertEq(client.balance - before, PRICE);
    }

    function test_delegate_thenReleaseRemainder() public {
        vm.prank(client);
        escrow.fund{value: PRICE}();
        uint256 amt = 3 * 1e8;
        bytes memory dsig = _delegationSig(subAgent, amt, 11);
        vm.prank(operator);
        escrow.delegate(subAgent, amt, 11, dsig);
        vm.prank(agent);
        escrow.submit(keccak256("work"));
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
        vm.expectRevert(JobEscrowV2.NotAllowed.selector);
        escrow.delegate(subAgent, amt, 1, okSig);
        // signature for a different amount
        vm.prank(operator);
        vm.expectRevert(JobEscrowV2.BadSignature.selector);
        escrow.delegate(subAgent, amt, 1, wrongAmountSig);
        // more than the escrow holds
        vm.prank(operator);
        vm.expectRevert(JobEscrowV2.WrongAmount.selector);
        escrow.delegate(subAgent, PRICE + 1, 2, tooMuchSig);
        // nonce reuse
        vm.prank(operator);
        escrow.delegate(subAgent, amt, 3, nonce3Sig);
        vm.prank(operator);
        vm.expectRevert(JobEscrowV2.NonceUsed.selector);
        escrow.delegate(subAgent, amt, 3, nonce3Sig);
    }

    function test_refundAfterDelegationReturnsRemainder() public {
        vm.prank(client);
        escrow.fund{value: PRICE}();
        uint256 amt = 2 * 1e8;
        bytes memory dsig = _delegationSig(subAgent, amt, 21);
        bytes memory vsig = _verdictSig(0, 22);
        vm.prank(operator);
        escrow.delegate(subAgent, amt, 21, dsig);
        vm.prank(agent);
        escrow.submit(keccak256("work"));
        uint256 before = client.balance;
        escrow.refund(22, vsig);
        assertEq(client.balance - before, PRICE - amt);
    }

    // ---------------- V2 additions ----------------
    uint256 constant CAP = PRICE * 3000 / 10_000; // 3 HBAR

    function _fund() internal {
        vm.prank(client);
        escrow.fund{value: PRICE}();
    }

    function _delegate(uint256 amt, uint256 nonce) internal {
        bytes memory sig = _delegationSig(subAgent, amt, nonce);
        vm.prank(operator);
        escrow.delegate(subAgent, amt, nonce, sig);
    }

    function test_constructorParamsReadBack() public view {
        assertEq(escrow.maxDelegatedBps(), 3000);
        assertEq(escrow.reviewWindow(), 72 hours);
        assertEq(escrow.submittedAt(), 0);
    }

    function test_capBoundaryExactlyAtCapOk() public {
        _fund();
        _delegate(CAP, 1);
        assertEq(escrow.delegated(), CAP);
    }

    function test_capPlusOneReverts() public {
        _fund();
        bytes memory sig = _delegationSig(subAgent, CAP + 1, 1);
        vm.prank(operator);
        vm.expectRevert(JobEscrowV2.CapExceeded.selector);
        escrow.delegate(subAgent, CAP + 1, 1, sig);
    }

    function test_cumulativeCapAcrossTwoDelegations() public {
        _fund();
        _delegate(2 * 1e8, 1);
        _delegate(1e8, 2); // total exactly CAP
        bytes memory sig = _delegationSig(subAgent, 1, 3);
        vm.prank(operator);
        vm.expectRevert(JobEscrowV2.CapExceeded.selector);
        escrow.delegate(subAgent, 1, 3, sig);
        assertEq(escrow.delegated(), CAP);
    }

    function test_cumulativeCapSecondOverReverts() public {
        _fund();
        _delegate(2 * 1e8, 1);
        bytes memory sig = _delegationSig(subAgent, 1e8 + 1, 2);
        vm.prank(operator);
        vm.expectRevert(JobEscrowV2.CapExceeded.selector);
        escrow.delegate(subAgent, 1e8 + 1, 2, sig);
    }

    function test_delegateAfterSubmitReverts() public {
        _fundAndSubmit();
        bytes memory sig = _delegationSig(subAgent, 1e8, 1);
        vm.prank(operator);
        vm.expectRevert(JobEscrowV2.WrongState.selector);
        escrow.delegate(subAgent, 1e8, 1, sig);
    }

    function test_delegateBeforeFundReverts() public {
        bytes memory sig = _delegationSig(subAgent, 1e8, 1);
        vm.prank(operator);
        vm.expectRevert(JobEscrowV2.WrongState.selector);
        escrow.delegate(subAgent, 1e8, 1, sig);
    }

    function test_refundIfNoVerdict_beforeWindowReverts() public {
        _fundAndSubmit();
        vm.expectRevert(JobEscrowV2.TooEarly.selector);
        escrow.refundIfNoVerdict();
        vm.warp(block.timestamp + 72 hours); // boundary: still not past
        vm.expectRevert(JobEscrowV2.TooEarly.selector);
        escrow.refundIfNoVerdict();
    }

    function test_refundIfNoVerdict_afterWindowRefundsClient() public {
        _fundAndSubmit();
        assertEq(escrow.submittedAt(), block.timestamp);
        vm.warp(block.timestamp + 72 hours + 1);
        uint256 before = client.balance;
        vm.expectEmit(true, false, false, true);
        emit JobEscrowV2.Refunded(AID, client, PRICE);
        vm.prank(address(0xBEEF)); // anyone
        escrow.refundIfNoVerdict();
        assertEq(client.balance - before, PRICE);
        assertEq(address(escrow).balance, 0);
        assertEq(uint8(escrow.state()), uint8(JobEscrowV2.State.Refunded));
    }

    function test_refundIfNoVerdict_afterPartialDelegation() public {
        _fund();
        _delegate(2 * 1e8, 1);
        vm.prank(agent);
        escrow.submit(keccak256("work"));
        vm.warp(block.timestamp + 72 hours + 1);
        uint256 before = client.balance;
        escrow.refundIfNoVerdict();
        assertEq(client.balance - before, PRICE - 2 * 1e8);
        assertEq(address(escrow).balance, 0);
    }

    function test_refundIfNoVerdict_inFundedReverts() public {
        _fund();
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(JobEscrowV2.WrongState.selector);
        escrow.refundIfNoVerdict();
    }

    function test_refundIfNoVerdict_inCreatedReverts() public {
        vm.expectRevert(JobEscrowV2.WrongState.selector);
        escrow.refundIfNoVerdict();
    }

    function test_refundIfNoVerdict_inReleasedReverts() public {
        _fundAndSubmit();
        escrow.release(1, _verdictSig(1, 1));
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(JobEscrowV2.WrongState.selector);
        escrow.refundIfNoVerdict();
    }

    function test_refundIfNoVerdict_inRefundedReverts() public {
        _fundAndSubmit();
        escrow.refund(1, _verdictSig(0, 1));
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(JobEscrowV2.WrongState.selector);
        escrow.refundIfNoVerdict();
    }

    function test_verdictStillWorksInsideWindow() public {
        _fundAndSubmit();
        vm.warp(block.timestamp + 72 hours);
        escrow.release(1, _verdictSig(1, 1));
        assertEq(uint8(escrow.state()), uint8(JobEscrowV2.State.Released));
    }

    function test_deadlineRefundNotAvailableAfterSubmit() public {
        _fundAndSubmit();
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(JobEscrowV2.WrongState.selector);
        escrow.refundAfterDeadline();
    }

    // ---- factory ----
    function test_factory_shortDeadlineReverts() public {
        vm.startPrank(operator);
        vm.expectRevert(AgreementFactoryV2.DeadlineTooSoon.selector);
        factory.createEscrow(keccak256("s"), client, agent, PRICE, uint64(block.timestamp + 899));
        vm.stopPrank();
    }

    function test_factory_pastDeadlineReverts() public {
        vm.warp(10_000);
        vm.startPrank(operator);
        vm.expectRevert(AgreementFactoryV2.DeadlineTooSoon.selector);
        factory.createEscrow(keccak256("s"), client, agent, PRICE, 5_000);
        vm.expectRevert(AgreementFactoryV2.DeadlineTooSoon.selector);
        factory.createEscrow(keccak256("s"), client, agent, PRICE, 0);
        vm.stopPrank();
    }

    function test_factory_minDeadlineBoundaryOk() public {
        vm.prank(operator);
        factory.createEscrow(keccak256("b"), client, agent, PRICE, uint64(block.timestamp + 900));
    }

    function test_factory_zeroPriceReverts() public {
        vm.prank(operator);
        vm.expectRevert(AgreementFactoryV2.ZeroPrice.selector);
        factory.createEscrow(keccak256("z"), client, agent, 0, uint64(block.timestamp + 1 days));
    }

    function test_factory_zeroVerifierReverts() public {
        vm.expectRevert(AgreementFactoryV2.ZeroVerifier.selector);
        new AgreementFactoryV2(address(0));
        vm.prank(operator);
        vm.expectRevert(AgreementFactoryV2.ZeroVerifier.selector);
        factory.setVerifier(address(0));
    }

    function test_factory_defaults() public view {
        assertEq(factory.maxDelegatedBps(), 3000);
        assertEq(factory.reviewWindow(), 72 hours);
        assertEq(factory.minDeadline(), 900);
        assertEq(factory.owner(), operator);
    }

    function test_factory_emitsEscrowCreated() public {
        vm.prank(operator);
        vm.recordLogs();
        address e = factory.createEscrow(keccak256("ev"), client, agent, PRICE, uint64(block.timestamp + 1 days));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs[logs.length - 1].topics[0], keccak256("EscrowCreated(bytes32,address,address,address,uint256)"));
        assertEq(logs[logs.length - 1].topics[1], keccak256("ev"));
        assertEq(factory.escrowOf(keccak256("ev")), e);
    }

    function test_factory_settersOwnerOnly() public {
        vm.expectRevert(AgreementFactoryV2.NotOwner.selector);
        factory.setVerifier(address(1));
        vm.expectRevert(AgreementFactoryV2.NotOwner.selector);
        factory.setMaxDelegatedBps(100);
        vm.expectRevert(AgreementFactoryV2.NotOwner.selector);
        factory.setReviewWindow(1 hours);
        vm.expectRevert(AgreementFactoryV2.NotOwner.selector);
        factory.setMinDeadline(1 hours);
    }

    function test_factory_setterBounds() public {
        vm.startPrank(operator);
        factory.setMaxDelegatedBps(10_000);
        factory.setMaxDelegatedBps(0);
        vm.expectRevert(AgreementFactoryV2.OutOfBounds.selector);
        factory.setMaxDelegatedBps(10_001);

        factory.setReviewWindow(1 minutes);
        factory.setReviewWindow(30 days);
        vm.expectRevert(AgreementFactoryV2.OutOfBounds.selector);
        factory.setReviewWindow(1 minutes - 1);
        vm.expectRevert(AgreementFactoryV2.OutOfBounds.selector);
        factory.setReviewWindow(30 days + 1);

        factory.setMinDeadline(1 minutes);
        factory.setMinDeadline(30 days);
        vm.expectRevert(AgreementFactoryV2.OutOfBounds.selector);
        factory.setMinDeadline(59);
        vm.expectRevert(AgreementFactoryV2.OutOfBounds.selector);
        factory.setMinDeadline(30 days + 1);
        vm.stopPrank();
    }

    function test_factory_settersAffectOnlyFutureEscrows() public {
        vm.startPrank(operator);
        factory.setMaxDelegatedBps(5000);
        factory.setReviewWindow(1 hours);
        JobEscrowV2 e2 = JobEscrowV2(payable(factory.createEscrow(keccak256("f"), client, agent, PRICE, uint64(block.timestamp + 1 days))));
        vm.stopPrank();
        assertEq(e2.maxDelegatedBps(), 5000);
        assertEq(e2.reviewWindow(), 1 hours);
        assertEq(escrow.maxDelegatedBps(), 3000);
        assertEq(escrow.reviewWindow(), 72 hours);
    }

    function test_escrow_constructorRejectsBadBps() public {
        vm.expectRevert(JobEscrowV2.BadConfig.selector);
        new JobEscrowV2(AID, client, agent, operator, verifier, PRICE, 1, 10_001, 1 hours);
    }

    function test_zeroBpsBlocksAllDelegation() public {
        vm.startPrank(operator);
        factory.setMaxDelegatedBps(0);
        JobEscrowV2 e2 = JobEscrowV2(payable(factory.createEscrow(keccak256("g"), client, agent, PRICE, uint64(block.timestamp + 1 days))));
        vm.stopPrank();
        vm.prank(client);
        e2.fund{value: PRICE}();
        vm.prank(operator);
        vm.expectRevert(JobEscrowV2.CapExceeded.selector);
        e2.delegate(subAgent, 1, 1, hex"00");
    }
}
