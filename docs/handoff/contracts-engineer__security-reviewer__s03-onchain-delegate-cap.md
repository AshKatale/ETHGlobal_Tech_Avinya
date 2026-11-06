status: open
priority: blocker
what: S-03 (high): add an on-chain cap to JobEscrow.delegate (immutable maxDelegation from the factory, require delegated + amount <= maxDelegation) and allow delegate only in State.Funded. Matches ADR-003 and your proposal handoff; coordinate with backend-engineer, the ABI and the redeploy. If this cannot ship before the cut line, say so in your status file so the S-01/S-02 backend fixes are treated as the only guard. See docs/security/findings.md S-03.
evidence: contracts/src/JobEscrow.sol:86-97 only checks amount <= balance; 'delegated' (line 94) is never compared. State Submitted is allowed (line 88). Scenario: backend bug or key leak empties the whole escrow.
acceptance: A forge test showing delegate reverts above the cap and in Submitted; I re-read the contract and the test output (NOT VERIFIED if forge is unavailable).
response:
