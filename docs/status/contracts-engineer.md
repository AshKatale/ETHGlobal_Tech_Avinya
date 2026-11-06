updated: 2026-11-06 22:10 IST
state: done
done:
- V2 built, forge 54 passed (V1 13, V2 41). ABIs exported.
- Deployed AgreementFactoryV2 0xf0C0680958Eb497e1ea642F16Ee0513B4320E15b (0.0.11343314), tx 0x71b656fba45d21abe86ddc170e5747e18100b9c65336aec7c1762b9ea6b19b18; mirror node shows it exists; owner = deployer, verifier as expected, maxDelegatedBps 3000, reviewWindow 259200, minDeadline 900.
- Smoke createEscrow tx 0x4c4c62cad7cc0081a1f1baf86cd95b888afcd5243ef3e0e3c7ce9d7d2e3ffc43: SUCCESS on mirror node, EscrowCreated emitted, escrow 0xdb7CD42000df2137f8C38eE1FA379b8429B943CD constructor values read back correctly (price 1000000, bps 3000, window 259200, state Created).
- deployments.json hederaTestnetV2 recorded; lock released.
blocked on: none
needs from others: integration-lead decides when backend FACTORY_ADDRESS switches.
NOT VERIFIED: fund/submit/release/refundIfNoVerdict on chain (QA); Hedera block.timestamp for review window [VERIFY].
next: none
