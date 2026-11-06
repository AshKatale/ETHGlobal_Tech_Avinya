# Contract change proposals

## Status (2026-11-06)
Human approved a side-by-side V2 (`src/JobEscrowV2.sol`, `src/AgreementFactoryV2.sol`). V1 is untouched and still the default until `integration-lead` switches `FACTORY_ADDRESS`.
- P1 implemented in V2 as `refundIfNoVerdict()` (72 h default `reviewWindow`, owner-settable 1 min to 30 days for future escrows). Name differs from the proposal text (`TooEarly` / `WrongState` errors reused).
- P5 implemented in V2 (`maxDelegatedBps`, default 3000, constructor param, `CapExceeded`), cumulative against `price`; also `delegate` is Funded only (S-03).
- S-15 implemented in V2 factory: `price > 0`, `deadline >= now + minDeadline` (900 s default); zero verifier rejected in constructor and `setVerifier`.
- P2 unchanged (`submit` still agent or operator): the backend relays submit for agents with plain wallets, enforcing agent-only would break the flow; doc fix is the recommendation.
- P3 unchanged (shared `usedNonce`): kept so signing code and ABI (`usedNonce`) stay identical; not exploitable, backend nonces are random.
- P4 unchanged (`refundAfterDeadline` open to anyone): intended liveness, recipient is always the client.

Original proposals below are kept for history. Each originally needed an ADR (`architect`) and a redeploy decision (`integration-lead`). Each needs an ADR (`architect`) and a redeploy decision (`integration-lead`). Any change to `JobEscrow` needs a new factory deployment, because the escrow bytecode is baked into the factory. Hedera behaviour claims are tagged `[VERIFY]`.

Baseline: `forge test` 13 passed, 0 failed (forge 1.9.0). Existing tests cover every case in the work-order list.

Priority: P1 > P2 > P3 > P4 > P5.

## P1. Timeout for an escrow stuck in `Submitted` (high)
Problem: `refundAfterDeadline` needs `Funded`. After `submit`, if the verifier never signs, funds are locked forever (`release` and `refund` both need a verifier signature).
Change (add constant and function; keep `deadline` semantics):
```solidity
uint64 public constant VERDICT_WINDOW = 3 days; // [VERIFY] choose per demo needs
uint64 public submittedAt;
error TooEarlyVerdict();

// in submit(), after state = Submitted:
submittedAt = uint64(block.timestamp);

/// Verifier never answered: client is refunded the remainder.
function refundIfNoVerdict() external {
    if (state != State.Submitted) revert WrongState();
    if (block.timestamp <= uint256(submittedAt) + VERDICT_WINDOW) revert TooEarly();
    _refundClient();
}
```
Trade-off: favours the client; a malicious or offline verifier can no longer strand funds, but an agent who did good work loses it if the platform is down for longer than the window. Alternative: split remainder or require a client-signed claim. ADR decision.
Tests (add to `JobEscrow.t.sol`):
- `test_refundIfNoVerdict_afterWindow`: fund, submit, `vm.warp(+VERDICT_WINDOW+1)`, call, assert `Refunded` and client balance +price.
- `test_refundIfNoVerdict_beforeWindowReverts`: expectRevert `TooEarly`.
- `test_refundIfNoVerdict_notSubmittedReverts`: Funded state expectRevert `WrongState`.
- `test_releaseStillWorksBeforeWindow`.

## P2. `submit` allows agent or operator; the doc says agent only (medium)
Problem: the operator (backend relayer, also the factory owner) can submit any hash on behalf of the agent. The agent's payout address may be a plain wallet that never calls the contract, so operator submit is likely intended by the backend flow. The risk is that a compromised relayer can move any Funded escrow to Submitted with a garbage hash; money still needs a verifier signature, so the loss is bounded to a FAIL/refund or a stuck escrow (see P1).
Options: (a) keep the code and fix the architecture doc to "agent or operator" (no redeploy; recommended if no wallet-signing by agents is planned); (b) enforce `msg.sender == agent` (breaks the current backend flow).
Exact change for (b): `if (msg.sender != agent) revert NotAllowed();`
Tests: replace `test_onlyAgentOrOperatorCanSubmit` with one that asserts the operator reverts `NotAllowed`; or under (a) leave unchanged.

## P3. One nonce set shared by verdicts and delegations (low)
Problem: `usedNonce` is shared, so the backend must never reuse a nonce across the two kinds. A delegation nonce `n` blocks a verdict with nonce `n`. It is not exploitable (signatures bind the type hash), only a liveness footgun.
Change: separate mappings.
```solidity
mapping(uint256 => bool) public usedVerdictNonce;
mapping(uint256 => bool) public usedDelegationNonce;
```
`_checkVerdict` uses the first, `delegate` the second. This changes the ABI: `usedNonce(uint256)` is replaced, so notify `backend-engineer` (uses it?) and `frontend-engineer`.
Tests: `test_sameNonceForDelegationAndVerdictBothSucceed`; the replay tests assert per-kind replay still reverts `NonceUsed`.
Cheaper alternative with no redeploy: backend uses disjoint nonce ranges (e.g. verdict nonces even, delegation odd) and documents it in `api.md`.

## P4. `refundAfterDeadline` callable by anyone (info, likely fine)
The recipient is always `client` and the state/time checks gate it, so a third party can only trigger the refund the client is already owed. This is intentional permissionless liveness. A caller cannot redirect funds. One residual: any `Delegated` payouts already made are not recovered, which is correct. No change recommended; document as intended. Optional test: `test_deadlineRefund_anyoneCanCallButClientReceives` (call from a random address, assert the client balance rose and the caller's did not).

## P5. 30% A2A cap is backend-only (medium)
Problem: the operator plus a verifier signature can delegate up to the full balance (`amount <= address(this).balance`). The cap is enforced only in backend code, and the backend signs with the verifier key too, so a backend bug (see charter gap: concurrent `/a2a/call` overspend) can overspend on-chain.
Change:
```solidity
uint256 public constant MAX_DELEGATED_BPS = 3000;
error CapExceeded();
// in delegate(), before effects:
if ((delegated + amount) * 10_000 > price * MAX_DELEGATED_BPS) revert CapExceeded();
```
Note: `price` is the original funding, so the cap is against price, not remaining balance. Overflow is not a concern at tinybar scale (Solidity 0.8 checks anyway).
Tests: `test_delegateCapBoundaryAllowed` (exactly 30% passes), `test_delegateOverCapReverts` (30% + 1 tinybar reverts `CapExceeded`), `test_cumulativeDelegationsCountAgainstCap`, and update `test_delegateGuards` / `test_delegate_thenReleaseRemainder` amounts if they exceed 30%.

## Other observations
- `forge build` lint notes: `setVerifier` has no zero-address check (note: `JobEscrow` with `verifier == 0` would reject all signatures because `_recover` already reverts on a zero signer, so the escrow would just be stuck, see P1). Suggest `if (_verifier == address(0)) revert` in the factory constructor and `setVerifier`.
- `setVerifier` affects only future escrows (verifier is baked in at creation). A rotated or leaked verifier key cannot be replaced on existing escrows. Consider in the P1 redesign.
- `fund()` is client only and exactly `price`; native transfers to the escrow by anyone else (via `selfdestruct` or the Hedera equivalents) would be swept into release/refund because payouts use `address(this).balance`. Not a loss for the intended parties. `[VERIFY]` whether Hedera allows forced balance additions.
- `price` of 0 is accepted by the factory; `fund()` with 0 value would then work. Suggest `price > 0`.
- Deployment drift: the deployed factory at `deployments.json` was not compared with the current source (NOT VERIFIED).
