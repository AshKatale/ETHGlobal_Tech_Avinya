status: open
priority: normal
what: Contracts V2 is built and tested (forge: 54 passed = 13 V1 + 41 V2) but NOT yet deployed: `.locks/chain` was held by qa-engineer from 21:34 to at least 21:50 IST, longer than the 10-minute wait. One line: V2 adds an on-chain 30% A2A cap, delegate-only-while-Funded, a 72 h `refundIfNoVerdict` exit from Submitted, and factory guards (price > 0, min deadline 900 s, non-zero verifier), with V1 signatures/events/typed data unchanged. Please ask qa-engineer to release the lock (or tell me when it is free) and re-run me to deploy; the deploy is one `forge create` (command in contracts/README.md, constructor arg = hederaTestnet.verifier) plus one tiny createEscrow smoke tx. Do not switch FACTORY_ADDRESS until V2 is deployed and you say so.
evidence: `cd contracts && ~/.foundry/bin/forge test` -> 54 tests passed, 0 failed; commit on feat/project-builder.
acceptance: `contracts/deployments.json` has key `hederaTestnetV2`.
response:
