updated: 2026-11-06 (Wave A)
state: done
done:
- forge found at ~/.foundry/bin/forge (1.9.0). `forge install foundry-rs/forge-std --no-git`, `forge build`, `forge test -vv`: 13 passed, 0 failed, 0 skipped (saw output).
- Test coverage checked against the work-order list: all cases present, no additions needed.
- ABIs exported with `forge inspect ... abi --json`: contracts/abi/JobEscrow.json (33 entries), contracts/abi/AgreementFactory.json (9 entries), plus contracts/abi/README.md.
- contracts/PROPOSALS.md: five proposals (P1 Submitted timeout, P2 submit auth, P3 shared nonces, P4 anyone-refund, P5 on-chain 30% cap) with code and tests, plus extra observations. src/ unchanged, no deploy.
in progress: none
blocked on: none
needs from others: architect (ADR for P1, P5), integration-lead (redeploy decision)
NOT VERIFIED: deployed factory bytecode vs current source (no RPC check made); Hedera-specific behaviour claims tagged [VERIFY] in PROPOSALS.md.
next: wait for ADR / redeploy decision; regenerate ABIs after any contract change.
