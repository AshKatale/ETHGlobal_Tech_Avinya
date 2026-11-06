// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {TaskFactory} from "../src/TaskFactory.sol";
import {TaskEscrow} from "../src/TaskEscrow.sol";

contract TaskEscrowTest is Test {
    TaskFactory factory;
    TaskEscrow task;

    uint256 verifierKey = 0xA11CE;
    address verifier;
    address designer = address(0xDE51);
    address operator = address(0x0BE);
    address client = address(0xC11E);
    address payable agentA = payable(address(0xA6E));
    address payable agentB = payable(address(0xB0B));
    address payable agentC = payable(address(0xC0C));

    uint256 constant PRICE = 10 * 1e8;      // 10 HBAR in tinybar
    uint16 constant MAX_SUB_BPS = 3_000;    // sub-legs may take 30% = 3 HBAR
    uint8 constant MAX_SUB_LEGS = 2;
    uint32 constant GRACE = 1 hours;
    bytes32 constant AID = keccak256("agreement-1");
    bytes32 constant TERMS = keccak256("terms-root");
    bytes32 constant SUBTERMS = keccak256("terms-sub");

    function setUp() public {
        verifier = vm.addr(verifierKey);
        factory = new TaskFactory(designer, operator, verifier);
        vm.prank(designer);
        task = TaskEscrow(factory.createTask(AID, client, agentA, PRICE, uint64(block.timestamp + 1 days), MAX_SUB_BPS, MAX_SUB_LEGS, GRACE, TERMS));
        vm.deal(client, 100 ether);
    }

    // ---------- signature helpers (compute BEFORE vm.prank/expectRevert: the external call would consume them) ----------
    function _sign(bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", task.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(verifierKey, digest);
        return abi.encodePacked(r, s, v);
    }
    function _verdict(uint8 result, uint256 nonce) internal view returns (bytes memory) {
        return _sign(keccak256(abi.encode(keccak256("Verdict(bytes32 agreementId,uint8 result,uint256 nonce)"), AID, result, nonce)));
    }
    function _subLeg(address sub, uint256 p, bytes32 th, uint256 nonce) internal view returns (bytes memory) {
        return _sign(keccak256(abi.encode(
            keccak256("SubLeg(bytes32 agreementId,address subAgent,uint256 price,bytes32 termsHash,uint256 nonce)"), AID, sub, p, th, nonce)));
    }
    function _fundWallet() internal { vm.prank(client); task.fund{value: PRICE}(); }
    function _fundX402() internal { vm.deal(address(task), PRICE); task.confirmFunding(); } // native transfer, no code run
    function _addSub(address payable sub, uint256 p, uint256 nonce) internal returns (uint256) {
        bytes memory sig = _subLeg(sub, p, SUBTERMS, nonce);
        vm.prank(operator);
        return task.addSubLeg(sub, p, SUBTERMS, nonce, sig);
    }
    function _submitAndRelease() internal {
        vm.prank(agentA);
        task.submit(keccak256("work"));
        bytes memory sig = _verdict(1, 900);
        task.release(900, sig);
    }

    // ---------- funding ----------
    function test_fundByWallet() public {
        _fundWallet();
        assertEq(uint8(task.state()), uint8(TaskEscrow.State.Funded));
        assertEq(address(task).balance, PRICE);
    }

    function test_fundByX402NativeTransfer_thenConfirm() public {
        vm.deal(address(task), PRICE); // what an x402 settlement does: balance rises, no function runs
        assertEq(uint8(task.state()), uint8(TaskEscrow.State.Created));
        task.confirmFunding();
        assertEq(uint8(task.state()), uint8(TaskEscrow.State.Funded));
    }

    function test_confirmFundingRevertsWhenUnderfunded() public {
        vm.deal(address(task), PRICE - 1);
        vm.expectRevert(TaskEscrow.NotFunded.selector);
        task.confirmFunding();
    }

    function test_walletFundGuards() public {
        vm.prank(client);
        vm.expectRevert(TaskEscrow.WrongAmount.selector);
        task.fund{value: PRICE - 1}();
        vm.deal(address(0xBAD), 100 ether);
        vm.prank(address(0xBAD));
        vm.expectRevert(TaskEscrow.NotAllowed.selector);
        task.fund{value: PRICE}();
    }

    // ---------- settlement ----------
    function test_release_paysAgentAWholeBalance() public {
        _fundX402();
        uint256 before = agentA.balance;
        _submitAndRelease();
        assertEq(agentA.balance - before, PRICE);
        assertEq(address(task).balance, 0);
        assertEq(uint8(task.state()), uint8(TaskEscrow.State.Released));
    }

    function test_refund_returnsToClient_andVoidsSubLegs() public {
        _fundX402();
        _addSub(agentB, 2 * 1e8, 1);
        vm.prank(agentA);
        task.submit(keccak256("work"));
        bytes memory sig = _verdict(0, 7);
        uint256 before = client.balance;
        task.refund(7, sig);
        assertEq(client.balance - before, PRICE);
        assertFalse(task.owed(1)); // nothing owed after a refund
    }

    function test_wrongVerdictDirectionAndReplay() public {
        _fundX402();
        vm.prank(agentA);
        task.submit(bytes32(0));
        bytes memory passSig = _verdict(1, 1);
        bytes memory failSig = _verdict(0, 2);
        vm.expectRevert(TaskEscrow.BadSignature.selector);
        task.refund(1, passSig);
        vm.expectRevert(TaskEscrow.BadSignature.selector);
        task.release(2, failSig);
        task.release(1, passSig);
        vm.expectRevert(TaskEscrow.WrongState.selector);
        task.release(1, passSig);
    }

    function test_deadlineRefund() public {
        _fundX402();
        vm.expectRevert(TaskEscrow.TooEarly.selector);
        task.refundAfterDeadline();
        vm.warp(block.timestamp + 1 days + 1);
        uint256 before = client.balance;
        task.refundAfterDeadline();
        assertEq(client.balance - before, PRICE);
    }

    // ---------- sub-legs (A -> B), max 2 hops ----------
    function test_addSubLeg_recordsLegAndCountsTowardsCap() public {
        _fundX402();
        uint256 id = _addSub(agentB, 2 * 1e8, 1);
        assertEq(id, 1);
        assertEq(task.legCount(), 2);
        assertEq(task.subTotal(), 2 * 1e8);
        (address payee, uint256 p, bytes32 th,) = task.leg(1);
        assertEq(payee, agentB);
        assertEq(p, 2 * 1e8);
        assertEq(th, SUBTERMS);
    }

    function test_subLegCapIsEnforced() public {
        _fundX402();
        _addSub(agentB, 2 * 1e8, 1);                  // 2 of 3 HBAR cap
        bytes memory tooMuch = _subLeg(agentC, 1e8 + 1, SUBTERMS, 2);
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.CapExceeded.selector);
        task.addSubLeg(agentC, 1e8 + 1, SUBTERMS, 2, tooMuch);
        _addSub(agentC, 1e8, 3);                      // exactly at the cap is fine
    }

    function test_subLegCountLimit() public {
        _fundX402();
        _addSub(agentB, 1e8, 1);
        _addSub(agentC, 1e8, 2);
        bytes memory sig = _subLeg(address(0xD0D), 1e7, SUBTERMS, 3);
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.TooManyLegs.selector);
        task.addSubLeg(payable(address(0xD0D)), 1e7, SUBTERMS, 3, sig);
    }

    function test_subLegGuards() public {
        _fundX402();
        bytes memory good = _subLeg(agentB, 1e8, SUBTERMS, 1);
        // only the operator
        vm.expectRevert(TaskEscrow.NotAllowed.selector);
        task.addSubLeg(agentB, 1e8, SUBTERMS, 1, good);
        // signature for different terms
        bytes memory other = _subLeg(agentB, 1e8, keccak256("other"), 1);
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.BadSignature.selector);
        task.addSubLeg(agentB, 1e8, SUBTERMS, 1, other);
        // A cannot hire itself; zero price
        bytes memory selfSig = _subLeg(agentA, 1e8, SUBTERMS, 2);
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.BadLeg.selector);
        task.addSubLeg(agentA, 1e8, SUBTERMS, 2, selfSig);
        bytes memory zeroSig = _subLeg(agentB, 0, SUBTERMS, 3);
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.BadLeg.selector);
        task.addSubLeg(agentB, 0, SUBTERMS, 3, zeroSig);
        // nonce reuse
        vm.prank(operator);
        task.addSubLeg(agentB, 1e8, SUBTERMS, 1, good);
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.NonceUsed.selector);
        task.addSubLeg(agentB, 1e8, SUBTERMS, 1, good);
    }

    function test_noSubLegsBeforeFundingOrAfterRelease() public {
        bytes memory sig = _subLeg(agentB, 1e8, SUBTERMS, 1);
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.WrongState.selector);
        task.addSubLeg(agentB, 1e8, SUBTERMS, 1, sig); // not funded yet
        _fundX402();
        _submitAndRelease();
        bytes memory sig2 = _subLeg(agentB, 1e8, SUBTERMS, 2);
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.WrongState.selector);
        task.addSubLeg(agentB, 1e8, SUBTERMS, 2, sig2); // released
    }

    // ---------- A pays B over x402; receipt recorded; default after grace ----------
    function test_owedThenRecordPayout() public {
        _fundX402();
        uint256 id = _addSub(agentB, 2 * 1e8, 1);
        assertFalse(task.owed(id));          // not owed until the task is released
        _submitAndRelease();
        assertTrue(task.owed(id));
        vm.prank(operator);
        task.recordPayout(id, "0.0.7162784@1793970887.617954312");
        assertFalse(task.owed(id));
        (, , , TaskEscrow.LegStatus st) = task.leg(id);
        assertEq(uint8(st), uint8(TaskEscrow.LegStatus.Paid));
    }

    function test_recordPayoutGuards() public {
        _fundX402();
        uint256 id = _addSub(agentB, 2 * 1e8, 1);
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.WrongState.selector);
        task.recordPayout(id, "tx"); // not released yet
        _submitAndRelease();
        vm.expectRevert(TaskEscrow.NotAllowed.selector);
        task.recordPayout(id, "tx"); // not operator
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.BadLeg.selector);
        task.recordPayout(0, "tx"); // root leg is paid by the contract itself
        vm.prank(operator);
        task.recordPayout(id, "tx");
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.WrongState.selector);
        task.recordPayout(id, "tx"); // already paid
    }

    function test_defaultAfterGrace_andCannotRecordAfterwards() public {
        _fundX402();
        uint256 id = _addSub(agentB, 2 * 1e8, 1);
        _submitAndRelease();
        vm.expectRevert(TaskEscrow.TooEarly.selector);
        task.markDefault(id);
        vm.warp(block.timestamp + GRACE + 1);
        task.markDefault(id); // anyone
        assertFalse(task.owed(id));
        (, , , TaskEscrow.LegStatus st) = task.leg(id);
        assertEq(uint8(st), uint8(TaskEscrow.LegStatus.Defaulted));
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.WrongState.selector);
        task.recordPayout(id, "late");
    }

    function test_paidLegCannotBeMarkedDefault() public {
        _fundX402();
        uint256 id = _addSub(agentB, 2 * 1e8, 1);
        _submitAndRelease();
        vm.prank(operator);
        task.recordPayout(id, "tx");
        vm.warp(block.timestamp + GRACE + 1);
        vm.expectRevert(TaskEscrow.WrongState.selector);
        task.markDefault(id);
    }

    // ---------- signatures are bound to this contract ----------
    function test_signatureFromAnotherTaskIsRejected() public {
        vm.prank(designer);
        TaskEscrow other = TaskEscrow(factory.createTask(keccak256("agreement-2"), client, agentA, PRICE, uint64(block.timestamp + 1 days), MAX_SUB_BPS, MAX_SUB_LEGS, GRACE, TERMS));
        vm.deal(address(other), PRICE);
        other.confirmFunding();
        vm.prank(agentA);
        other.submit(bytes32(0));
        _fundX402();
        bytes memory sigForFirst = _verdict(1, 3);
        vm.expectRevert(TaskEscrow.BadSignature.selector);
        other.release(3, sigForFirst);
    }

    // ---------- factory ----------
    function test_factoryOnlyDesignerAndBounds() public {
        vm.expectRevert(TaskFactory.NotDesigner.selector);
        factory.createTask(keccak256("x"), client, agentA, PRICE, uint64(block.timestamp + 1 days), 1000, 1, GRACE, TERMS);
        vm.startPrank(designer);
        vm.expectRevert(TaskFactory.AlreadyExists.selector);
        factory.createTask(AID, client, agentA, PRICE, uint64(block.timestamp + 1 days), 1000, 1, GRACE, TERMS);
        vm.expectRevert(TaskFactory.OutOfBounds.selector); // sub cap above the hard limit
        factory.createTask(keccak256("a"), client, agentA, PRICE, uint64(block.timestamp + 1 days), 5_001, 1, GRACE, TERMS);
        vm.expectRevert(TaskFactory.OutOfBounds.selector); // grace too short
        factory.createTask(keccak256("b"), client, agentA, PRICE, uint64(block.timestamp + 1 days), 1000, 1, 10, TERMS);
        vm.expectRevert(TaskFactory.OutOfBounds.selector); // deadline in the past
        factory.createTask(keccak256("c"), client, agentA, PRICE, uint64(block.timestamp), 1000, 1, GRACE, TERMS);
        vm.expectRevert(TaskFactory.OutOfBounds.selector); // client == agent
        factory.createTask(keccak256("d"), agentA, agentA, PRICE, uint64(block.timestamp + 1 days), 1000, 1, GRACE, TERMS);
        vm.stopPrank();
        assertEq(factory.taskOf(AID), address(task));
        assertEq(task.designer(), designer);
    }
}
