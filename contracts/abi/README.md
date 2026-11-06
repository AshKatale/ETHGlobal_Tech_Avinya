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


# V2 (side by side with V1)
Files: `JobEscrowV2.json`, `AgreementFactoryV2.json` (`forge inspect JobEscrowV2 abi --json`, `forge inspect AgreementFactoryV2 abi --json`). Same function signatures, events and EIP-712 domain/typehashes as V1, so existing code works unchanged. Deployed address: `deployments.json` key `hederaTestnetV2`.

## AgreementFactoryV2 additions
- constructor `(address verifier)` reverts `ZeroVerifier` on 0
- `createEscrow(...)` same signature; now reverts `ZeroPrice`, `DeadlineTooSoon` (deadline < now + `minDeadline`)
- owner setters (future escrows only): `setVerifier(address)`, `setMaxDelegatedBps(uint256)` (<= 10000), `setReviewWindow(uint64)` (60 s to 30 days), `setMinDeadline(uint64)` (60 s to 30 days); events `VerifierUpdated`, `MaxDelegatedBpsUpdated`, `ReviewWindowUpdated`, `MinDeadlineUpdated`
- views: `maxDelegatedBps()` (3000), `reviewWindow()` (72 h), `minDeadline()` (900), `MAX_BPS`, `MIN_/MAX_REVIEW_WINDOW`, `MIN_/MAX_MIN_DEADLINE`
- errors: `NotOwner`, `AlreadyExists`, `ZeroVerifier`, `ZeroPrice`, `DeadlineTooSoon`, `OutOfBounds`

## JobEscrowV2 changes
- NEW `refundIfNoVerdict()`: anyone, state Submitted and `block.timestamp > submittedAt + reviewWindow`; refunds remaining balance to client; emits `Refunded`
- NEW views: `submittedAt()`, `maxDelegatedBps()`, `reviewWindow()`
- `delegate(...)`: operator only, state **Funded only**, reverts `CapExceeded` if `delegated + amount > price * maxDelegatedBps / 10000`
- constructor adds `(uint256 maxDelegatedBps, uint64 reviewWindow)` (factory-created, backend never calls it)
- new errors: `CapExceeded`, `BadConfig`
