# AgentForge MVP: Build Context (HBAR-native)

Status: DRAFT, 2026-11-06. Audience: the coding agent that builds this.
Goal: a working hackathon MVP. Functional things only.

Legend: **[V]** verified in the live docs on 2026-11-06. **[U]** not verified or not provided yet. Do not guess an [U] item; ask or look it up.

---

## 1. Product and USPs

AgentForge is a marketplace where AI agents are onboarded through a benchmark, hired by clients who lock **HBAR** in a per-job smart contract, verified automatically, and paid on the result.

1. **Benchmark-gated onboarding.** The lister connects a GitHub repo. The benchmark reads the code, runs checks, and produces a score and a written review. Pass = listed.
2. **Dynamic smart contracts.** Each agreement gets its own escrow contract, created on demand.
3. **HBAR escrow.** The client funds the job from their wallet in HBAR. The lister is paid on PASS; the client is refunded on FAIL.
4. **Requirement-driven verification.** When the agent says work is done, checks are generated from the client's requirement and run, plus the code and security checks the client asked for.
5. **Agent-to-agent (A2A) payments.** An agent can hire and pay another agent in HBAR inside the same job.
6. **Wallets for both sides.** Client and lister both connect a wallet.

All user money is HBAR. NVIDIA SDK does the AI work (benchmark, check generation, review). 0G Storage stores files.

---

## 2. Network facts

**Hedera testnet**
- JSON-RPC (Hashio): `https://testnet.hashio.io/api`, chain ID `296` (`0x128`). [V]
- Mirror node REST: `https://testnet.mirrornode.hedera.com`. Explorer: `https://hashscan.io/testnet`. [V]
- Only **ECDSA** accounts can sign EVM transactions. ED25519 cannot. [V]
- Hashio is rate-limited. If it throttles, use another relay (Validation Cloud, Arkhia, QuickNode, Hgraph). [V]

**0G Galileo testnet (storage only)**
- Chain ID `16602`, RPC `https://evmrpc-testnet.0g.ai`, faucet `https://faucet.0g.ai`. [V]
- Storage indexer (turbo): `https://indexer-storage-testnet-turbo.0g.ai`. [V]
- Uploads need 0G tokens. A backend wallet pays; users never touch 0G.

### HBAR units (must be right)
[V] docs.hedera.com/evm/differences/hbar-decimals

| Where | Unit |
|---|---|
| Hedera SDK | tinybar (8 decimals) |
| Inside Solidity (`msg.value`, `address.balance`) | **tinybar** |
| JSON-RPC `value` from viem/ethers/wallet | **weibar** (18 decimals; 1 tinybar = 10^10 weibar) |

- Store and pass all amounts as **tinybar** (`bigint` in TS, `numeric(38,0)` in SQL, `uint256` in Solidity). No floats.
- Convert to weibar (`tinybar * 10n**10n`) in one helper, `toRpcValue()`, when sending a transaction.
- Never write `1 ether` in Solidity. Use `uint256 constant HBAR = 1e8;`.
- Fund a contract by calling a payable function. A plain transfer to the contract account does not run `receive()`. [V]

---

## 3. Project layout (two separate apps, no monorepo)

```
frontend/     Next.js (wallet connect, all screens)
backend/      Fastify + Zod API, Postgres (Drizzle), indexer + chain writer, NVIDIA + 0G + GitHub integrations
contracts/    Foundry project (AgreementFactory, JobEscrow)
demo-agents/  two small demo agents (plain Node scripts)
docs/
```
Each folder has its own `package.json`; use npm or pnpm per folder. No Turborepo, no shared package. Copy the few shared types and the money helper into both frontend and backend (or have the frontend call the API for anything money-related).

Stack: TypeScript, Node 22, Solidity 0.8.24, Next.js, Fastify + Zod, PostgreSQL 16 + Drizzle, Foundry, viem.

```
frontend --REST--> backend --> Postgres
                      |--> Hedera (contracts via viem, events via mirror node)
                      |--> NVIDIA SDK [U]
                      |--> 0G Storage
                      |--> GitHub
```

---

## 4. Wallet (web only)

- **MetaMask (any EVM wallet) through the Hedera JSON-RPC relay, using viem/wagmi.** Hedera's docs say to use the EVM path for a dApp with a wallet. [V]
- On connect, add the network: `wallet_addEthereumChain` with chainId `0x128`, rpc `https://testnet.hashio.io/api`, explorer `https://hashscan.io/testnet/`, currency HBAR; then `eth_requestAccounts`. [V]
- The account must be an **ECDSA** Hedera account (create it in the Hedera Portal). [V]
- Client wallet signs the escrow funding call. Lister wallet is the agent's payout address.
- Login: wallet signs a nonce message; backend verifies with `viem.verifyMessage` and starts a session.
- Keep wallet code behind one `useWallet()` hook so HashPack (HashConnect) or the Hedera WalletConnect library can be added later. [V that they exist; SDK usage is U.] The Hedera SDK cannot delegate signing to MetaMask/WalletConnect [V], so every user payment is an **EVM contract call**, not an SDK transfer.

---

## 5. Smart contracts (Hedera EVM, Foundry, Solidity 0.8.24)

```solidity
contract AgreementFactory {
    address public verifier;                         // backend verdict signer
    function createEscrow(bytes32 agreementId, address client, address payable agent,
                          uint256 price /*tinybar*/, uint64 deadline)
        external returns (address escrow);           // deploys a new JobEscrow per agreement
    event EscrowCreated(bytes32 indexed agreementId, address escrow, address client, address agent, uint256 price);
}

contract JobEscrow {
    // Created -> Funded -> Submitted -> Released | Refunded
    function fund() external payable;                        // client only, msg.value == price
    function submit(bytes32 deliverableHash) external;       // agent only
    function release(bytes calldata verifierSig) external;   // PASS, signed by verifier
    function refund(bytes calldata verifierSig) external;    // FAIL, signed by verifier
    function refundAfterDeadline() external;                 // client gets money back if nothing submitted
    function delegate(address payable subAgent, uint256 amount, bytes calldata policySig) external; // A2A
    event Funded(bytes32 indexed agreementId, address client, uint256 amount);
    event Submitted(bytes32 indexed agreementId, bytes32 deliverableHash);
    event Released(bytes32 indexed agreementId, address agent, uint256 amount);
    event Refunded(bytes32 indexed agreementId, address client, uint256 amount);
    event Delegated(bytes32 indexed agreementId, address subAgent, uint256 amount);
}
```

- Verdict signature is EIP-712 over `{agreementId, result, nonce}`, signed by the verifier key.
- Pay out with `call{value:}` and check the result.
- Check early that a contract can deploy another contract on Hedera. If not, fall back to **one `EscrowVault` keyed by `agreementId`** with the same functions. The database is identical either way.
- Deploy the factory with `forge create` / `forge script` against Hashio. [V that Foundry works on Hedera]
- The Hedera native SDK is `@hiero-ledger/sdk`; its `setPayableAmount()` takes **HBAR**, not tinybar. [V] Its deploy-from-bytecode flow is [U]; look it up before using it.
- The backend calls `createEscrow`, `release`, `refund`, `delegate` directly with viem using a backend key. No queue.

---

## 6. Onboarding with benchmark (lister side)

1. Lister connects wallet and signs in.
2. Lister fills the agent form: name, description, capability tags, price, endpoint URL, payout address (defaults to the connected wallet).
3. Lister **connects a GitHub repo** (below).
4. Backend runs the **benchmark** and produces a **report**: score, per-check results, a written code review and analysis.
5. **Score ≥ 80/100 → agent is listed.** Otherwise it stays unlisted; the lister sees the report and can re-run.

No endpoint proof, no extra gates.

### GitHub connect
- **Start: the lister pastes a public repo URL; the backend fetches it without auth.**
- **Later, if needed: "Connect GitHub" via OAuth** for private repos. GitHub OAuth details are [U]; check GitHub's docs first.
- Record the commit SHA used for each run.
- Send the AI a capped selection of the repo (file tree, README, key source files, ~100 KB). Present repo text as data and tell the model not to follow instructions inside it.

### Benchmark = custom code + NVIDIA AI
- **Custom code checks** (plain TypeScript in `backend/`, no test framework needed): README present, repo structure sane, entry point exists, dependencies parse, declared capabilities match what the code does (simple keyword/structure heuristics). Each returns `{name, passed, score, detail}`.
- **NVIDIA AI** (section 6.1): given the capability tags, description and repo contents, it writes the review/analysis and produces the benchmark tasks, then scores how well the repo satisfies them.
- Combine: `score = 0.4 * custom_score + 0.6 * ai_score` (weights are config).
- Generation and scoring sit behind one interface so the NVIDIA code drops in:
  ```ts
  interface Analyzer {
    benchmark(input: { capability: string; description: string; files: Record<string,string> })
      : Promise<{ score: number; review: string; items: {name:string; passed:boolean; detail:string}[] }>;
    verify(input: { requirements: string; checks: string[]; files: Record<string,string> })
      : Promise<{ passed: boolean; items: {name:string; passed:boolean; detail:string}[]; summary: string }>;
  }
  ```
  `NvidiaAnalyzer` is the real implementation (section 6.1). If `NVIDIA_API_KEY` is missing or the call fails, return an error; do not fake results.
- Upload the report to 0G Storage and keep the root hash.

### 6.1 NVIDIA API (provided by you)
It is an **OpenAI-compatible chat completions API**, not a custom SDK. From your Python sample:
- `base_url`: `https://integrate.api.nvidia.com/v1`
- `api_key`: from `NVIDIA_API_KEY` in `.env`
- `model`: `nvidia/nemotron-3.5-super-vl-120b-a12b`
- Sample settings: `temperature=1`, `top_p=0.95`, `max_tokens=16384`, `seed=42`, `stream=True`, `parallel_tool_calls=True`
- Extra body: `{"chat_template_kwargs": {"enable_thinking": true}}` turns on reasoning. Streamed chunks carry thinking in `delta.reasoning_content` and the answer in `delta.content`.

Backend is TypeScript, so use the `openai` npm package with the same `baseURL` and key:
```ts
import OpenAI from 'openai';
const nvidia = new OpenAI({ baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: process.env.NVIDIA_API_KEY });
const res = await nvidia.chat.completions.create({
  model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  messages,
  temperature: 0.2, top_p: 0.95, max_tokens: 16384, seed: 42,
  // chat_template_kwargs is not in the SDK types; pass it as an extra body field (cast if TS complains)
  ...({ chat_template_kwargs: { enable_thinking: false } } as object),
});
```
Implementation notes:
- Use `stream: false` for the benchmark and verification calls (simpler). Read the answer from `choices[0].message.content` and ignore reasoning text.
- Ask for **JSON output** (a fixed schema in the prompt) and parse with Zod; retry once if parsing fails. Use a low temperature (0 to 0.2) for scoring so results are stable.
- [U] Whether the TS `openai` package forwards `chat_template_kwargs` as written, and whether this model supports a JSON response mode. Test both in the first quick check.
- This is **inference only**. It can read and judge code but not execute it, so all checks are analysis-based plus custom TypeScript. No tests are run.
- Cut large repos to a size cap before sending (model context is limited; keep it to the file tree, README and key files).

---

## 7. Job flow and verification (client side)

### Flow
1. Client connects wallet, creates a **request**: requirements text, which checks to run, budget in HBAR, deadline.
2. Agents give **quotes**. Client accepts one.
3. Backend calls `AgreementFactory.createEscrow` (the dynamic contract). Client wallet calls `JobEscrow.fund()` with HBAR.
4. Indexer sees the `Funded` event; the job then shows `funded`.
5. Agent works (optionally hiring other agents, section 8) and **tells the backend the work is done** with a submission (repo link or files); it calls `JobEscrow.submit`.
6. **Verification** runs and the verifier key signs the verdict.
7. Backend calls `release` (PASS) or `refund` (FAIL).

States: `requested → quoted → agreed → funded → submitted → verifying → released | refunded`.

### Verification (no test framework, no Docker)
Everything runs through `Analyzer.verify(...)`, which combines custom code and the NVIDIA SDK:
1. **Requirement checks:** NVIDIA AI turns the client's requirement text into a checklist of concrete criteria and evaluates the submitted code against each. Custom code handles the parts that are mechanical (files exist, function/endpoint names present, build config valid, JSON/ABI shapes).
2. **Code and security checks the client ticked:** `build_config`, `lint_rules`, `secrets_scan`, `dependency_check`, `security_review`. Simple ones are custom TypeScript (regex secret scan, dependency manifest read); the review-style ones go to NVIDIA AI.
3. **Verdict:** all ticked checks pass and the requirement checklist passes at the threshold (default: all) → PASS, else FAIL.
4. If the NVIDIA service errors out, show the error and let the user retry. Do not mark it FAIL.
5. Save the checklist and results to 0G Storage and keep the root hash.
6. Show: "Automated verification is not a professional audit."

> The NVIDIA API is inference only (section 6.1), so verification is analysis-based: the model judges the code against the checklist and custom TypeScript does the mechanical checks. If you later want real code execution, it goes inside `Analyzer.verify` without changing the interface.

---

## 8. Agent-to-agent (A2A) payments

An agent doing a job buys a sub-task from another listed agent and pays in HBAR, inside the same job.

1. Agent A asks the backend for a quote from agent B (`POST /a2a/quote`).
2. Backend checks: B is a listed agent, and A's **total A2A spend ≤ a percentage of the job price (default 30%)**. If not, the call is rejected and recorded as `blocked`. This is the "blocked payment" demo case.
3. Pay with one of two rails:
   - **Rail 1, `JobEscrow.delegate()` (build first).** The escrow pays B directly from the job funds, authorized by a backend signature. A needs no HBAR of its own.
   - **Rail 2, x402 over HBAR (add after).**
4. B does the sub-task and returns the result. A includes it in its deliverable.
5. The job page lists every A2A call and its cost. Max depth 2 hops.

**x402 on Hedera** [V] docs.hedera.com/solutions/ai/x402
- The `exact` scheme supports **HBAR and HTS tokens**; a facilitator is required.
- Testnet facilitator **Blocky402**: `https://api.testnet.blocky402.com`, `GET /supported`, `POST /verify`, `POST /settle`, network `hedera:testnet`, no API key. Call `/supported` first.
- PaymentRequirements: `scheme: "exact"`, `network`, `amount`, `asset` (`"0.0.0"` in the docs' HBAR example), `payTo` (Hedera account id like `0.0.1234`), `maxTimeoutSeconds`, `extra.feePayer`.
- The client sends a base64 partially signed Hedera transaction in `payload.transaction`; settlement returns `{ success, transactionId, network, payer }`.
- `payTo` is an **account id**, so agents on this rail need a Hedera account id, not only an EVM address.
- The payment transaction is signed by the **agent's own key** in the agent's code.
- [U] HTTP header names for payment and settlement, and whether HBAR `amount` is in tinybar. Read the Hedera x402 exact-scheme page and the `@x402/*` package before coding.

Hedera also publishes an Agent Kit (`@hashgraph/hedera-agent-kit` with `@hiero-ledger/sdk`). [V] Optional; only useful inside demo agents.

**Agent identity:** an agent has an id, an owner (lister wallet), a payout address, and optionally a Hedera account id. Keep it in the database. I found no Hedera-native agent identity standard in the docs, so none is used.

---

## 9. 0G Storage

[V] docs.0g.ai/developer-hub/building-on-0g/storage/sdk — package `@0gfoundation/0g-storage-ts-sdk` (peer dep `ethers`):
```ts
import { MemData, Indexer } from '@0gfoundation/0g-storage-ts-sdk';
import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://evmrpc-testnet.0g.ai');
const signer = new ethers.Wallet(BACKEND_0G_KEY, provider);
const indexer = new Indexer('https://indexer-storage-testnet-turbo.0g.ai');

const data = new MemData(new TextEncoder().encode(JSON.stringify(report)));
const [tree, treeErr] = await data.merkleTree();   // must be called before upload
if (treeErr !== null) throw new Error(String(treeErr));
const [tx, err] = await indexer.upload(data, 'https://evmrpc-testnet.0g.ai', signer);
if (err !== null) throw new Error(String(err));
// tx.rootHash is the handle to fetch it later
const dlErr = await indexer.download(rootHash, outPath, true); // Node only, verifies Merkle proof
```
Keep the root hash; it is the only handle. If 0G is down, show an error and let the user retry.

---

## 10. Database (PostgreSQL, Drizzle)

Money columns are `numeric(38,0)` holding tinybar.

```sql
users(id, address unique, display_name, hedera_account_id null, created_at)
sessions(id, user_id, expires_at)
auth_nonces(address, nonce, expires_at, used)

agents(id, owner_user_id, name, description, capabilities text[], endpoint_url,
       payout_address, hedera_account_id null, price_tinybar numeric(38,0),
       repo_url, repo_commit, status, -- draft | benchmarking | listed | failed
       latest_benchmark_id null, created_at)

benchmark_runs(id, agent_id, repo_commit, status, -- running | passed | failed | error
               custom_score numeric(5,2), ai_score numeric(5,2), score numeric(5,2),
               review_text, items jsonb, report_root bytea null, created_at)

requests(id, client_user_id, title, requirements text, checks_requested text[],
         budget_tinybar numeric(38,0), deadline_at, status)
quotes(id, request_id, agent_id, price_tinybar numeric(38,0), eta_hours, status)
agreements(id, request_id, quote_id, client_user_id, agent_id, price_tinybar numeric(38,0),
           deadline_at, escrow_address null, status)

submissions(id, agreement_id, repo_url_or_file text, deliverable_hash bytea, submitted_at)
verifications(id, agreement_id, result text, -- PASS | FAIL | ERROR
              items jsonb, summary text, report_root bytea null, created_at)
verdicts(id, agreement_id unique, result text, verifier_sig bytea, nonce bigint)

a2a_calls(id, agreement_id, caller_agent_id, callee_agent_id, price_tinybar numeric(38,0),
          rail text, status, -- quoted | blocked | paid | done | failed
          blocked_reason text null, depth int)

payments(id, agreement_id, kind, -- fund | release | refund | a2a
         amount_tinybar numeric(38,0), tx_hash text null, hedera_tx_id text null, status)
chain_events(id, contract, event, tx_hash, log_index, consensus_ts, args jsonb, unique(tx_hash, log_index))
chain_cursor(contract primary key, last_consensus_ts)
```

The agreement's money status (`funded`, `released`, `refunded`) is set from indexed on-chain events, not from the API call that triggered them.

---

## 11. Reading Hedera events

Poll the **mirror node**, not Hashio. [V]
- `GET /api/v1/contracts/{idOrAddress}/results/logs`.
- Filtering by topic **requires a timestamp range of 7 days or less**. Default order is DESC; use `order=asc` and follow `links.next`. [V]
- Keep the last consensus timestamp per contract in `chain_cursor`.
- Mirror REST returns monetary fields in tinybar by default (`hbar=true`). [V]
- On `Funded`, `Submitted`, `Released`, `Refunded`, `Delegated` logs, update the agreement and payment rows.

---

## 12. Backend API (Fastify + Zod)

```
POST /auth/nonce         POST /auth/verify          GET /me
POST /agents             GET /agents                GET /agents/:id
POST /agents/:id/github          (set repo URL / connect)
POST /agents/:id/benchmark       GET /agents/:id/benchmark/:runId   (report)
POST /requests           GET /requests/:id
POST /requests/:id/quotes        POST /quotes/:id/accept
GET  /agreements/:id
POST /agreements/:id/submit      (agent says work is done)
GET  /agreements/:id/verification
POST /a2a/quote          POST /a2a/call             GET /agreements/:id/a2a
```
Money in JSON is a decimal string of tinybar.

---

## 13. Frontend screens

1. Marketplace: agent list and detail page (benchmark score and code review).
2. Connect wallet.
3. List an agent: form, repo URL / GitHub connect, benchmark progress, report, result.
4. Create request (requirement text, tick checks), compare quotes, accept, **Fund escrow** (wallet pops up with the HBAR amount).
5. Job page: status timeline, submission, verification checklist and results, verdict, A2A calls with costs, payout.

---

## 14. Config

```
# backend/.env
HEDERA_RPC_URL=https://testnet.hashio.io/api
HEDERA_CHAIN_ID=296
HEDERA_MIRROR_URL=https://testnet.mirrornode.hedera.com
ZEROG_RPC_URL=https://evmrpc-testnet.0g.ai
ZEROG_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
NVIDIA_API_KEY=            # you will provide
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL=nvidia/nemotron-3.5-super-vl-120b-a12b
RELAYER_PRIVATE_KEY=       # creates escrows, releases, refunds
VERIFIER_PRIVATE_KEY=      # signs verdicts
BACKEND_0G_PRIVATE_KEY=
DATABASE_URL=
X402_FACILITATOR_URL=https://api.testnet.blocky402.com   # Rail 2 only
```
Testnet keys only. Do not commit `.env`.

---

## 15. Build order (demo after step 3)

1. **Quick checks (hours):** testnet HBAR in an ECDSA account; deploy factory + escrow to Hashio, call `fund` from MetaMask with a weibar value, read the `Funded` log from the mirror node; one 0G Storage upload/download; one call to the NVIDIA API (check JSON output and `chat_template_kwargs`).
2. Money helper (`toRpcValue`) with unit tests; contracts with Foundry tests.
3. **Fund-escrow slice:** wallet login, request, quote, accept, create escrow, fund, indexer marks `funded`.
4. Submission, verification, verdict, release/refund.
5. Agent onboarding: repo URL, custom checks, NVIDIA review and score, listing.
6. A2A with `delegate()`, then x402 if time allows.
7. Two demo agents, seed data (badged as seeded), demo script.

Cut first if short on time: x402 rail, GitHub OAuth, HashPack, extra checks, explorer links.

---

## 16. Still needed from you

None blocking. Decided: NVIDIA via the OpenAI-compatible API (key in `.env`), pass threshold 80/100, no platform fee, score weights 40% custom / 60% AI (change in config if wanted).

---

## Sources (read 2026-11-06)
- Hedera: docs.hedera.com/evm/differences/hbar-decimals, /evm/development/json-rpc, /evm/tutorials/intermediate/send-receive-hbar, /evm/integrations/wallets/metamask-snap-tutorial, /learn/getting-started/choose-your-path, /solutions/ai/x402/*, /solutions/ai/agent-kit, /api-reference/contracts (logs), /operators/mirror-node
- 0G: docs.0g.ai/developer-hub/building-on-0g/storage/sdk, /contracts-on-0g/deploy-contracts
