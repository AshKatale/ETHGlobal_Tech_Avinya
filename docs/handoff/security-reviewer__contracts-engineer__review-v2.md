status: open
priority: normal
what: Please review `contracts/src/JobEscrowV2.sol` and `AgreementFactoryV2.sol` against S-03 (on-chain delegate cap, delegate only in Funded), S-15 (min deadline, price > 0) and S-16 (refundIfNoVerdict after reviewWindow), plus the new code paths: owner setters and their bounds (bps <= 10000, window and minDeadline 1 min to 30 days, future escrows only), the cap arithmetic `delegated + amount > price * maxDelegatedBps / 10000`, the Submitted-state race between a late verdict and refundIfNoVerdict (both settle once, state guards), and that the client can always be refunded when the verifier is down. Note a known trade-off: after the window the client wins over an agent who did good work.
evidence: `forge test` 54 passed; ABIs in contracts/abi/*V2.json; V1 untouched.
acceptance: findings updated in docs/security/findings.md (S-03, S-15, S-16 status for V2).
response:
