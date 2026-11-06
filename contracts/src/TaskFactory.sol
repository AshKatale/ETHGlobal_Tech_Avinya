// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TaskEscrow} from "./TaskEscrow.sol";

/// @notice Deploys one TaskEscrow per task. Only the `designer` (the Solidity agent's wallet) can deploy, and the factory
/// enforces hard bounds on the dynamic terms, so even a misbehaving designer cannot create an unsafe contract.
contract TaskFactory {
    address public immutable owner;      // admin: rotates roles
    address public designer;             // Solidity agent wallet, the only deployer
    address public operator;             // backend relayer
    address public verifier;             // platform verdict signer
    mapping(bytes32 => address) public taskOf;

    // Hard bounds on dynamic terms (last line of defence; the designer applies tighter, trust-based limits).
    uint16 public constant MAX_SUB_BPS = 5_000;       // sub-legs may take at most 50% of the price
    uint32 public constant MIN_GRACE = 60;            // seconds
    uint32 public constant MAX_GRACE = 7 days;

    event TaskCreated(
        bytes32 indexed agreementId, address task, address client, address agent, uint256 price, uint64 deadline,
        uint16 maxSubBps, uint8 maxSubLegs, uint32 payoutGrace, bytes32 termsHash, address designer
    );

    error NotOwner();
    error NotDesigner();
    error AlreadyExists();
    error OutOfBounds();

    constructor(address _designer, address _operator, address _verifier) {
        owner = msg.sender;
        designer = _designer;
        operator = _operator;
        verifier = _verifier;
    }

    function setRoles(address _designer, address _operator, address _verifier) external {
        if (msg.sender != owner) revert NotOwner();
        designer = _designer;
        operator = _operator;
        verifier = _verifier;
    }

    /// @param price tinybar
    function createTask(
        bytes32 agreementId, address client, address payable agent, uint256 price, uint64 deadline,
        uint16 maxSubBps, uint8 maxSubLegs, uint32 payoutGrace, bytes32 termsHash
    ) external returns (address task) {
        if (msg.sender != designer) revert NotDesigner();
        if (taskOf[agreementId] != address(0)) revert AlreadyExists();
        if (price == 0 || deadline <= block.timestamp) revert OutOfBounds();
        if (maxSubBps > MAX_SUB_BPS || payoutGrace < MIN_GRACE || payoutGrace > MAX_GRACE) revert OutOfBounds();
        if (client == address(0) || agent == address(0) || client == agent) revert OutOfBounds();

        task = address(new TaskEscrow(TaskEscrow.Terms({
            agreementId: agreementId, client: client, agent: agent, operator: operator, verifier: verifier,
            designer: msg.sender, price: price, deadline: deadline, maxSubBps: maxSubBps, maxSubLegs: maxSubLegs,
            payoutGrace: payoutGrace, termsHash: termsHash
        })));
        taskOf[agreementId] = task;
        emit TaskCreated(agreementId, task, client, agent, price, deadline, maxSubBps, maxSubLegs, payoutGrace, termsHash, msg.sender);
    }
}
