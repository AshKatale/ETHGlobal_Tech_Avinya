// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {JobEscrowV2} from "./JobEscrowV2.sol";

/// @notice V2 factory: creates one JobEscrowV2 per agreement. Only the backend relayer (owner) can create.
/// Owner-settable parameters apply to FUTURE escrows only (they are baked into each escrow).
contract AgreementFactoryV2 {
    uint256 public constant MAX_BPS = 10_000;
    uint64 public constant MIN_REVIEW_WINDOW = 1 minutes;
    uint64 public constant MAX_REVIEW_WINDOW = 30 days;
    uint64 public constant MIN_MIN_DEADLINE = 1 minutes;
    uint64 public constant MAX_MIN_DEADLINE = 30 days;

    address public immutable owner;
    address public verifier;
    uint256 public maxDelegatedBps = 3000;
    uint64 public reviewWindow = 72 hours;
    uint64 public minDeadline = 900;
    mapping(bytes32 => address) public escrowOf;

    event EscrowCreated(bytes32 indexed agreementId, address escrow, address client, address agent, uint256 price);
    event VerifierUpdated(address verifier);
    event MaxDelegatedBpsUpdated(uint256 bps);
    event ReviewWindowUpdated(uint64 seconds_);
    event MinDeadlineUpdated(uint64 seconds_);

    error NotOwner();
    error AlreadyExists();
    error ZeroVerifier();
    error ZeroPrice();
    error DeadlineTooSoon();
    error OutOfBounds();

    constructor(address _verifier) {
        if (_verifier == address(0)) revert ZeroVerifier();
        owner = msg.sender;
        verifier = _verifier;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setVerifier(address _verifier) external onlyOwner {
        if (_verifier == address(0)) revert ZeroVerifier();
        verifier = _verifier;
        emit VerifierUpdated(_verifier);
    }

    function setMaxDelegatedBps(uint256 bps) external onlyOwner {
        if (bps > MAX_BPS) revert OutOfBounds();
        maxDelegatedBps = bps;
        emit MaxDelegatedBpsUpdated(bps);
    }

    function setReviewWindow(uint64 secs) external onlyOwner {
        if (secs < MIN_REVIEW_WINDOW || secs > MAX_REVIEW_WINDOW) revert OutOfBounds();
        reviewWindow = secs;
        emit ReviewWindowUpdated(secs);
    }

    function setMinDeadline(uint64 secs) external onlyOwner {
        if (secs < MIN_MIN_DEADLINE || secs > MAX_MIN_DEADLINE) revert OutOfBounds();
        minDeadline = secs;
        emit MinDeadlineUpdated(secs);
    }

    /// @param price tinybar
    function createEscrow(bytes32 agreementId, address client, address payable agent, uint256 price, uint64 deadline)
        external
        onlyOwner
        returns (address escrow)
    {
        if (escrowOf[agreementId] != address(0)) revert AlreadyExists();
        if (price == 0) revert ZeroPrice();
        if (deadline < block.timestamp + minDeadline) revert DeadlineTooSoon();
        escrow = address(
            new JobEscrowV2(agreementId, client, agent, owner, verifier, price, deadline, maxDelegatedBps, reviewWindow)
        );
        escrowOf[agreementId] = escrow;
        emit EscrowCreated(agreementId, escrow, client, agent, price);
    }
}
