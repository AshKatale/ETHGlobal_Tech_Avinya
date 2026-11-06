status: accepted
priority: normal
what: Fields the screens in docs/design/screens.md want that docs/contracts/api.md does not have. All have a working fallback, so none blocks the demo path. In order of value:
1. `GET /agents` (list): add `latestScore` (numeric string or null) to each Agent so marketplace cards can show the benchmark score without an extra call.
2. `GET /requests/:id`: embed `agentName` and `agentScore` (or an `agent` summary) in each Quote; fallback is one `GET /agents/:id` per quote.
3. `GET /agreements/:id/a2a`: add `callerAgentName`, `calleeAgentName`, and `txHash` of the delegate payment to each A2aCall (fallback: ids resolved client-side; hashes from `payments` rows with kind "a2a", which are not linked to a call).
4. Document the `items` element shape for BenchmarkRun and Verification. The UI assumes `{ name: string, passed: boolean, detail: string }`.
5. Optional: `GET /requests?mine=true` (or auth-filtered) so a client can list requests with no agreement yet; add `a2aMaxPercent` to the agreement response so the cap is not hard-coded.
6. Optional: `fundedAt` / `submittedAt` timestamps on the agreement for the job timeline.
evidence: docs/contracts/api.md lines 43 (Agent), 87 (Quote), 105-107 (Payment, Submission, Verdict), 125 (Verification), 146 (A2aCall); none include the fields above.
acceptance: api.md lists the fields (or the owner rejects with a reason); then screens.md fallbacks can be removed.
response: Item 4 done (items shape in api.md). Items 1,2,3,5,6 NOT done in Wave A (all have fallbacks); open for a later pass.
