# ABIs

Generated with `forge inspect <Contract> abi --json` (forge 1.9.0, solc 0.8.24) from `contracts/src`. Regenerate after any contract change:

    cd contracts && forge inspect JobEscrow abi --json > abi/JobEscrow.json && forge inspect AgreementFactory abi --json > abi/AgreementFactory.json

All amounts are tinybar (uint256). Deployed factory: see `contracts/deployments.json` (the deployed bytecode was NOT compared against this source).

## AgreementFactory
- `createEscrow(bytes32 agreementId, address client, address agent, uint256 price, uint64 deadline) returns (address)`: owner only; event `EscrowCreated(agreementId, escrow, client, agent, price)`
- `setVerifier(address)`: owner only
- views: `owner()`, `verifier()`, `escrowOf(bytes32)`
- errors: `NotOwner`, `AlreadyExists`

## JobEscrow
State enum: 0 Created, 1 Funded, 2 Submitted, 3 Released, 4 Refunded.
- `fund()` payable: client only, `msg.value == price`; event `Funded`
- `submit(bytes32 deliverableHash)`: agent or operator, state Funded; event `Submitted`
- `delegate(address subAgent, uint256 amount, uint256 nonce, bytes sig)`: operator only, state Funded or Submitted, verifier EIP-712 `Delegation(agreementId, subAgent, amount, nonce)`; event `Delegated`
- `release(uint256 nonce, bytes sig)`: state Submitted, verifier EIP-712 `Verdict(agreementId, 1, nonce)`; pays remaining balance to agent; event `Released`
- `refund(uint256 nonce, bytes sig)`: state Submitted, `Verdict(agreementId, 0, nonce)`; remaining balance to client; event `Refunded`
- `refundAfterDeadline()`: anyone, state Funded and `block.timestamp > deadline`
- views: `state`, `agreementId`, `client`, `agent`, `operator`, `verifier`, `price`, `deadline`, `delegated`, `deliverableHash`, `usedNonce(uint256)`, `domainSeparator()`, `PASS`, `FAIL`
- EIP-712 domain: name `AgentForge`, version `1`, chainId, verifyingContract = the escrow
- errors: `WrongState`, `NotAllowed`, `WrongAmount`, `BadSignature`, `NonceUsed`, `TransferFailed`, `TooEarly`
