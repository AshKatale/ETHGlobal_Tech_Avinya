status: open
priority: normal
what: Contracts V2 exists side by side with V1 (ABIs `contracts/abi/JobEscrowV2.json`, `AgreementFactoryV2.json`; address in `contracts/deployments.json` key `hederaTestnetV2`). Same signatures, events and EIP-712 typed data as V1, so signing code is unchanged. Please (1) add `refundIfNoVerdict()` (anyone, state Submitted, after `reviewWindow`, default 72 h from `submittedAt`; emits the existing `Refunded`) to the escrow ABI you use and to any "stuck escrow" path; (2) treat `delegate` as Funded only: never sign or send a delegation once the agreement is Submitted; (3) expect `CapExceeded` if cumulative delegations exceed 30% of price (cap now on-chain, default 3000 bps); (4) createEscrow now reverts `ZeroPrice` and `DeadlineTooSoon` (deadline must be >= now + 900 s); new read-only views `submittedAt`, `maxDelegatedBps`, `reviewWindow`. Do NOT change FACTORY_ADDRESS to the V2 address until integration-lead says so.
evidence: contracts/abi/README.md section "V2"; `forge test`: 54 passed (13 V1 + 41 V2).
acceptance: backend typechecks against the V2 ABI; FACTORY_ADDRESS switch happens only after integration-lead confirms.
response:
