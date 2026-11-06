status: open
priority: normal
what: Implement the [planned] parts of docs/contracts/agent-protocol.md (call POST /quote and POST /tasks with retries and x-backend-key; dedupe-friendly). Per proposed ADRs (not yet Accepted): ADR-001 per-key send mutex and state pre-check; ADR-003 signature audit log; ADR-004 receipt success check and indexer-written payments.
evidence: docs/contracts/agent-protocol.md sections 1-2; docs/adr/ADR-001..004
acceptance: /tasks is called once after Funded; reverted delegate never calls the callee
response:
