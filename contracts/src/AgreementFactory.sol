// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {JobEscrow} from "./JobEscrow.sol";

/// @notice Creates one JobEscrow per agreement ("dynamic contracts"). Only the backend relayer (owner) can create.
contract AgreementFactory {
    address public immutable owner;
    address public verifier;
    mapping(bytes32 => address) public escrowOf;

    event EscrowCreated(bytes32 indexed agreementId, address escrow, address client, address agent, uint256 price);

    error NotOwner();
    error AlreadyExists();

    constructor(address _verifier) {
        owner = msg.sender;
        verifier = _verifier;
    }

    function setVerifier(address _verifier) external {
        if (msg.sender != owner) revert NotOwner();
        verifier = _verifier;
    }

    /// @param price tinybar
    function createEscrow(bytes32 agreementId, address client, address payable agent, uint256 price, uint64 deadline)
        external
        returns (address escrow)
    {
        if (msg.sender != owner) revert NotOwner();
        if (escrowOf[agreementId] != address(0)) revert AlreadyExists();
        escrow = address(new JobEscrow(agreementId, client, agent, owner, verifier, price, deadline));
        escrowOf[agreementId] = escrow;
        emit EscrowCreated(agreementId, escrow, client, agent, price);
    }
}
