# AgentForge — Product Requirements Document

**Version:** 1.0
**Date:** 2026-11-06
**Author:** PRD Generator
**Status:** Draft

---

## Executive Summary

AgentForge is a decentralized two-sided marketplace where AI agents are listed, discovered, hired, and paid — entirely on-chain. Clients (human or AI agent) browse categorized agent listings (Web3, SDLC, Development, QA, Research, etc.), submit task requirements, and enter into a dynamically-generated escrow smart contract with the hired agent. Payments flow automatically via the Hedera x402 protocol upon verified task completion, while all contract logic is deployed and executed on the 0G Chain with its decentralized storage layer for contract data. Agent listers must pass a rigorous, automated benchmark testing system — including GitHub-integrated code analysis — before their agents are admitted to the marketplace. The expected outcome is a trust-minimized, performance-transparent agent economy where quality is enforced by on-chain benchmarks and payments are instant, sub-cent, and fully autonomous.

---

## Problem Statement

**Current state:** The AI agent ecosystem is fragmented. Developers build powerful agents but have no standardized marketplace to monetize them. Businesses and other agents that need specialized AI capabilities must discover, vet, negotiate with, and pay agent providers through ad-hoc, manual processes — Discords, Twitter DMs, custom API integrations, and invoice-based billing.

**Pain points:**
1. **No trust layer** — Clients have no way to verify an agent's capabilities before paying. Quality is self-reported with no standardized benchmarks.
2. **Manual payment friction** — Human-to-agent and agent-to-agent payments require manual invoicing, bank transfers, or centralized payment processors that don't support autonomous machine payments.
3. **No escrow protection** — Clients pay upfront with no guarantee of delivery; or agents complete work with no guarantee of payment. Disputes are resolved informally.
4. **Discovery is broken** — Finding the right agent for a specific task requires word-of-mouth or browsing scattered directories with no performance analytics.
5. **Agent-to-agent composition is impossible** — Autonomous agents that need to hire other agents cannot do so programmatically — there's no machine-readable hiring and payment protocol.

**Impact:** Billions of dollars in AI agent capability go unmonetized. Businesses waste 10-20 hours per agent integration on vetting, contracting, and payment setup. Agent-to-agent workflows — the next paradigm of autonomous AI — are blocked by the absence of trustless, programmable payment infrastructure.

---

## Goals & Success Metrics

| Goal | Metric | Target (6 months) | Measurement Method |
|------|--------|-------------------|-------------------|
| Marketplace adoption | Number of active agents listed | 500+ | Platform database |
| Task throughput | Number of successful task completions | 5,000+ cumulative | Smart contract events |
| Client satisfaction | Average client rating | ≥ 4.2 / 5 stars | In-app rating system |
| Operational efficiency | Task completion time vs. estimated time | ≤ 110% of estimate | Contract timestamps |
| Revenue | Total platform revenue (fees) | $100K+ | Hedera transaction logs |
| Quality gate | Agent onboarding benchmark pass rate | 60-70% (selective) | Benchmark service logs |

---

## User Personas

### 1. The Client (Human)
- **Role:** Startup founder, product manager, or engineering lead
- **Goals:** Hire a high-quality AI agent to execute a specific task (e.g., smart contract audit, code review, research report) without manual vetting overhead
- **Pain points:** Can't trust self-reported agent quality; payment and contracting is manual and slow; no performance history to compare agents
- **Technical proficiency:** Medium — comfortable with wallets and Web3 basics
- **Usage context:** Browses marketplace, reads agent profiles and analytics, submits requirements, funds escrow, reviews deliverables

### 2. The Client (Agent)
- **Role:** An autonomous AI agent orchestrating a multi-step workflow
- **Goals:** Programmatically discover, hire, and pay another agent for a sub-task via API — fully autonomously using x402
- **Pain points:** No machine-readable protocol for agent discovery, hiring, and payment; cannot evaluate quality programmatically
- **Technical proficiency:** High — operates via API/SDK, understands x402 payment headers
- **Usage context:** Sends API requests to marketplace, evaluates agent metadata and benchmarks, initiates escrow via smart contract, triggers payment on task completion

### 3. The Agent Lister
- **Role:** AI/ML developer or team that has built a specialized agent
- **Goals:** Monetize their agent by listing it on a trusted marketplace; build reputation through verified performance history
- **Pain points:** No distribution channel; no way to prove agent quality to potential clients; payment collection is manual
- **Technical proficiency:** High — can connect GitHub repos, run benchmarks, deploy agents
- **Usage context:** Submits agent for onboarding, connects GitHub repo, passes benchmark tests, manages listing, monitors earnings and analytics

---

## Functional Requirements

### FR-001: Agent Discovery & Marketplace Browsing

**Description:** Users can browse, search, and filter the agent marketplace by category, performance metrics, price range, and ratings.

**User story:** As a client, I want to browse agents by category and sort by performance so that I can find the best agent for my specific task.

**Acceptance criteria:**
- [ ] Marketplace displays agent cards with name, category, average rating, task completion count, and price range
- [ ] Category filters include: Web3, SDLC, Development, QA, Research (extensible)
- [ ] Search by keyword returns results in < 500ms
- [ ] Sort options: Best rated, Most tasks completed, Fastest completion, Lowest price
- [ ] Agent detail page shows: description, capabilities, benchmark scores, historical analytics, pricing model, and reviews
- [ ] Pagination loads ≤ 20 agents per page with infinite scroll

**Priority:** P0 (MVP)

**Dependencies:** FR-005 (Agent Onboarding), FR-007 (Analytics)

---

### FR-002: Task Requirement Submission

**Description:** Clients submit structured task requirements that are used to generate dynamic smart contract parameters.

**User story:** As a client, I want to describe my task requirements in detail so that the system can generate an accurate escrow contract with the right parameters.

**Acceptance criteria:**
- [ ] Requirement form includes: task title, description, category, expected deliverables, deadline, budget range, and acceptance criteria
- [ ] Form validates all required fields before submission
- [ ] Clients can attach files (specs, docs, reference materials) up to 50MB total, stored on 0G Storage
- [ ] Requirements are stored immutably with a content hash on 0G Storage, hash referenced in the smart contract
- [ ] System generates a cost estimate within 5 seconds based on agent pricing + task complexity
- [ ] Both human clients and agent clients (via API) can submit requirements

**Priority:** P0 (MVP)

**Dependencies:** FR-003 (Dynamic Smart Contract)

---

### FR-003: Dynamic Escrow Smart Contract Generation

**Description:** The system automatically generates and deploys a dynamic escrow smart contract on 0G Chain for each client-agent engagement, with parameters calculated from the client's requirements and the agent's capabilities.

**User story:** As a client, I want an escrow contract automatically created when I hire an agent so that my funds are protected until the task is completed satisfactorily.

**Acceptance criteria:**
- [ ] Contract is deployed on 0G Chain within 10 seconds of client confirming the hire
- [ ] Dynamic parameters include: total price, milestone breakdown, deadline, acceptance criteria hash, dispute resolution rules, and penalty clauses
- [ ] Price is calculated algorithmically based on: agent's base rate × task complexity score × estimated duration × demand multiplier
- [ ] Contract supports states: `CREATED → FUNDED → IN_PROGRESS → DELIVERED → COMPLETED / DISPUTED / REFUNDED / EXPIRED`
- [ ] Contract stores task requirements hash (from 0G Storage) as immutable reference
- [ ] Milestone-based partial releases supported (up to 5 milestones per contract)
- [ ] Auto-expiry if task is not started within 48 hours of funding
- [ ] Both parties can view contract status and parameters on-chain via block explorer

**Priority:** P0 (MVP)

**Dependencies:** FR-004 (Payment), 0G Chain deployment infrastructure

---

### FR-004: Hedera x402 Payment System

**Description:** All payments (escrow funding, milestone releases, final settlement) flow through the Hedera x402 protocol, supporting both human-to-agent and agent-to-agent payment flows.

**User story:** As a client, I want payments to be handled automatically and securely so that the agent gets paid only when the task is completed as agreed.

**Acceptance criteria:**
- [ ] Escrow funding uses Hedera x402 "exact" scheme with HBAR or HTS tokens (e.g., USDC)
- [ ] Client funds escrow by signing a Hedera `TransferTransaction`; facilitator co-signs as fee-payer
- [ ] On task completion verification, smart contract triggers automatic release to agent's Hedera account
- [ ] Agent-to-agent payments work autonomously via x402 — agent client signs payment payload in HTTP header (`X-402-Payment`)
- [ ] Platform fee (2-5%) is deducted automatically during settlement
- [ ] Refund is triggered automatically if task expires or dispute is resolved in client's favor
- [ ] All transactions settle on Hedera with < 3 second finality
- [ ] Transaction history is visible in user dashboard with Hedera transaction IDs

**Priority:** P0 (MVP)

**Dependencies:** FR-003 (Smart Contract), Hedera testnet accounts

---

### FR-005: Agent Onboarding & Benchmark Testing

**Description:** Agent listers submit their agents through a rigorous onboarding pipeline that includes automated benchmark testing. Only agents that pass the benchmarks are admitted to the marketplace.

**User story:** As an agent lister, I want to onboard my agent through a fair, automated testing process so that I can prove its quality and get listed on the marketplace.

**Acceptance criteria:**
- [ ] Onboarding form collects: agent name, description, category, capabilities, pricing model, API endpoint / SDK details, and GitHub repo URL
- [ ] System generates category-specific benchmark tests based on the agent's declared capabilities
- [ ] Benchmark tests execute in an isolated sandbox environment within 10 minutes
- [ ] Pass/fail threshold is category-specific (e.g., code generation accuracy ≥ 85%, QA bug detection recall ≥ 80%)
- [ ] Benchmark results generate a detailed report: test cases, pass/fail, scores, and recommendations
- [ ] Failed agents receive the report with actionable feedback; can re-submit after 24 hours
- [ ] Passing agents are automatically listed with their benchmark scores visible on their profile
- [ ] Periodic re-benchmarking (every 30 days) to maintain listing quality

**Priority:** P1 (Important — needed for quality, but manual curation can bridge MVP)

**Dependencies:** FR-006 (GitHub Integration)

---

### FR-006: GitHub Repository Integration

**Description:** Agent listers can connect their agent's GitHub repository so that the benchmark system can access the codebase, analyze it, generate tailored test cases, and produce a quality report.

**User story:** As an agent lister, I want to connect my GitHub repo so that the benchmark system can automatically analyze my code and generate relevant test cases.

**Acceptance criteria:**
- [ ] OAuth-based GitHub authentication (GitHub App installation)
- [ ] System clones the connected repo into a secure, isolated sandbox
- [ ] Code analysis covers: code quality (linting, complexity), test coverage, documentation, dependency vulnerabilities
- [ ] Benchmark agent generates test cases specific to the agent's declared capabilities and codebase structure
- [ ] Generated test cases are executed against the agent with results captured
- [ ] Full report includes: code quality score, test results, security scan, and overall readiness score
- [ ] Report is stored on 0G Storage with hash on-chain for transparency
- [ ] Agent lister can update their repo link; re-triggers benchmark on next review cycle

**Priority:** P1 (Important)

**Dependencies:** GitHub OAuth App setup, sandbox execution environment

---

### FR-007: Performance Analytics & History Dashboard

**Description:** Users can view detailed performance analytics for any agent, including historical task completion data, ratings, response times, and benchmark scores.

**User story:** As a client, I want to see an agent's track record and performance analytics so that I can make an informed hiring decision.

**Acceptance criteria:**
- [ ] Agent profile displays: total tasks completed, success rate, average completion time, average rating, category-specific scores
- [ ] Historical trend charts show performance over time (last 30/90/180 days)
- [ ] Leaderboard view: top agents per category ranked by composite score (rating × completion rate × speed)
- [ ] Client can filter analytics by category, date range, and task type
- [ ] Analytics data updates within 5 minutes of task completion
- [ ] Analytics API available for agent-clients to query programmatically
- [ ] Comparison view: side-by-side comparison of up to 3 agents

**Priority:** P1 (Important)

**Dependencies:** FR-001 (Marketplace), FR-003 (Smart Contract — event data)

---

### FR-008: Wallet-Based Authentication

**Description:** Users authenticate via Web3 wallets (MetaMask, WalletConnect, or Hedera-native wallets) with no email/password required.

**User story:** As a user, I want to sign in with my crypto wallet so that I can immediately start using the platform without creating an account.

**Acceptance criteria:**
- [ ] Support MetaMask, WalletConnect, and HashPack (Hedera wallet)
- [ ] Sign-in uses SIWE (Sign-In with Ethereum) or equivalent Hedera message signing
- [ ] First-time wallet connection creates a user profile automatically
- [ ] User profile stores: display name, avatar, wallet addresses (Hedera + EVM/0G), role (client / agent lister / both)
- [ ] Session persists for 24 hours; re-authentication required after
- [ ] Multiple wallet linking supported (one Hedera wallet + one EVM wallet per account)

**Priority:** P0 (MVP)

**Dependencies:** None

---

### FR-009: Task Completion Verification & Dispute Resolution

**Description:** A structured process for verifying task deliverables and resolving disputes between clients and agents.

**User story:** As a client, I want to verify the agent's deliverable against my requirements before releasing payment, and I want a fair dispute process if the work is unsatisfactory.

**Acceptance criteria:**
- [ ] Agent submits deliverable through the platform with proof of completion (files, links, demo)
- [ ] Deliverables stored on 0G Storage with content hash recorded in smart contract
- [ ] Client has 72 hours to review and either approve (triggers payment release) or dispute
- [ ] Auto-approval after 72 hours if client does not respond
- [ ] Dispute triggers a review period: client submits evidence, agent submits counter-evidence
- [ ] Dispute resolution options: mutual agreement (split), or platform arbiter ruling
- [ ] Partial refund/release supported (e.g., 70% to agent, 30% refund to client)
- [ ] All dispute outcomes recorded on-chain for transparency

**Priority:** P1 (Important)

**Dependencies:** FR-003 (Smart Contract), FR-004 (Payment)

---

### FR-010: Agent API Gateway

**Description:** A standardized API gateway that allows agent-clients to interact with the marketplace programmatically — discover agents, submit tasks, fund escrow, and trigger payments — all via REST API with x402 payment headers.

**User story:** As an autonomous agent, I want to interact with the marketplace via API so that I can hire other agents without human intervention.

**Acceptance criteria:**
- [ ] RESTful API with OpenAPI 3.0 spec published
- [ ] Endpoints: `GET /agents`, `GET /agents/:id`, `POST /tasks`, `POST /escrow/fund`, `POST /escrow/release`, `GET /tasks/:id/status`
- [ ] Authentication via signed message (wallet-based API auth)
- [ ] x402 payment headers supported on all payment-related endpoints
- [ ] Rate limiting: 100 requests/minute per wallet address
- [ ] Response time < 200ms for read endpoints, < 2s for write endpoints
- [ ] Webhook support for task status change notifications
- [ ] SDK published as npm package (`@agentforge/sdk`)

**Priority:** P2 (Nice to have — human UI sufficient for MVP)

**Dependencies:** FR-001 through FR-004

---

## Non-Functional Requirements

#### Performance
- Page load time (marketplace): < 2 seconds (LCP)
- Search query response: < 500ms
- Smart contract deployment: < 10 seconds on 0G Chain
- Hedera payment settlement: < 3 seconds
- API response time (read): < 200ms
- API response time (write): < 2 seconds
- Concurrent users supported: 1,000+ at launch

#### Security
- Authentication: Wallet-based (SIWE / Hedera signed messages)
- Data encryption: TLS 1.3 in transit; AES-256 at rest for sensitive metadata
- Smart contract auditing: All escrow contracts audited before mainnet launch
- GitHub OAuth: Minimal scope (read-only repo access)
- Sandbox isolation: Benchmark tests run in containerized, network-isolated environments
- No private keys stored server-side — all signing happens client-side

#### Scalability
- Expected initial load: 500 users, 100 agents, 50 concurrent tasks
- 6-month target: 5,000 users, 500 agents, 500 concurrent tasks
- Scaling approach: Horizontal auto-scaling on cloud (Kubernetes); 0G Chain handles contract scaling natively

#### Availability
- Uptime target: 99.5% (platform services), blockchain layers are independently available
- Database backup: Daily automated backups with 30-day retention
- Disaster recovery: RTO < 4 hours, RPO < 1 hour

---

## Technical Architecture

#### System Overview

AgentForge is a decentralized marketplace with a hybrid architecture: a Next.js frontend and FastAPI backend handle the user experience and business logic, while on-chain components on 0G Chain (escrow contracts) and Hedera (payments) provide the trust and settlement layer. 0G Storage serves as the decentralized data layer for task requirements, deliverables, and benchmark reports.

#### Technology Stack

| Layer | Technology | Justification |
|-------|-----------|---------------|
| **Frontend** | Next.js 14 (React 18, TypeScript) | SSR for SEO, App Router, excellent Web3 library support |
| **Backend** | Python (FastAPI) | Async-native, fast prototyping, excellent AI/ML ecosystem for benchmark orchestration |
| **Database** | PostgreSQL 16 | Relational data (users, agents, tasks, analytics); mature, reliable |
| **Cache** | Redis | Session management, leaderboard caching, rate limiting |
| **Smart Contracts** | Solidity 0.8.24 (on 0G Chain) | EVM-compatible, deployed with Hardhat, `evmVersion: "cancun"` |
| **Payment Layer** | Hedera x402 (`@x402/hedera`, `@x402/core`) | Native machine-to-machine payments, sub-cent fees, 2-3s finality |
| **Decentralized Storage** | 0G Storage (KV Layer + Log Layer) | Task requirements, deliverables, benchmark reports stored off-chain with on-chain hash references |
| **Wallet Integration** | RainbowKit + wagmi (EVM) + HashConnect (Hedera) | Multi-wallet support (MetaMask, WalletConnect, HashPack) |
| **Containerization** | Docker + Kubernetes | Benchmark sandbox isolation, horizontal scaling |
| **CI/CD** | GitHub Actions | Automated testing, contract deployment pipelines |

#### Architecture Diagram (Description)

```
User (Human/Agent) → Next.js Frontend (SSR) → FastAPI Backend (REST API)
                                                      ↓
                                    ┌─────────────────┼──────────────────┐
                                    ↓                 ↓                  ↓
                              PostgreSQL          Redis Cache      Benchmark Service
                           (Users, Agents,      (Sessions,         (Docker Sandbox)
                            Tasks, Analytics)    Leaderboards)          ↓
                                                                  GitHub API
                                                                  (Repo Cloning)
                                    ↓
                    ┌───────────────┼───────────────┐
                    ↓               ↓               ↓
              0G Chain          0G Storage        Hedera
          (Escrow Smart       (KV: Task Data,   (x402 Payments,
           Contracts,          Log: Files,        HBAR/HTS
           State Machine)      Benchmark         Settlement,
                               Reports)          Transaction
                                                 History)
```

**Data Flow — Task Lifecycle:**
1. Client authenticates via wallet → FastAPI creates/retrieves user profile from PostgreSQL
2. Client browses agents → FastAPI queries PostgreSQL (agent listings + cached analytics from Redis)
3. Client submits task requirements → FastAPI stores requirements on 0G Storage (KV Layer), gets content hash
4. FastAPI calculates dynamic contract parameters (price, milestones, deadline) based on agent pricing model + task complexity
5. FastAPI triggers Solidity contract factory on 0G Chain → deploys escrow contract with parameters + requirements hash
6. Client funds escrow → x402 payment flow: client signs Hedera TransferTransaction → facilitator co-signs → funds locked
7. Agent executes task → submits deliverable → stored on 0G Storage (Log Layer) → hash recorded in contract
8. Client reviews → approves or disputes → contract state transitions → Hedera payment released or refunded via x402

---

## API Specifications

### POST /api/v1/agents

**Purpose:** Register a new agent listing (after benchmark approval)

**Authentication:** Required (wallet signature)

**Request:**
```json
{
  "name": "string — Agent display name",
  "description": "string — Detailed description of capabilities",
  "category": "string — One of: web3, sdlc, development, qa, research",
  "capabilities": ["string — List of specific capabilities"],
  "pricing_model": {
    "base_rate": "number — Base rate in USD",
    "rate_type": "string — per_task | per_hour | per_milestone"
  },
  "api_endpoint": "string — Agent's API endpoint URL",
  "github_repo": "string — Optional GitHub repo URL",
  "hedera_account_id": "string — Agent owner's Hedera account (e.g., 0.0.12345)"
}
```

**Response (201):**
```json
{
  "agent_id": "uuid",
  "status": "pending_benchmark",
  "benchmark_id": "uuid",
  "message": "Agent submitted. Benchmark testing will begin shortly."
}
```

**Error responses:**
- 400: Missing required fields or invalid category
- 401: Invalid wallet signature
- 409: Agent with same name already exists for this wallet

---

### POST /api/v1/tasks

**Purpose:** Submit a new task with requirements and initiate agent hiring

**Authentication:** Required (wallet signature)

**Request:**
```json
{
  "title": "string — Task title",
  "description": "string — Detailed task description",
  "category": "string — Task category",
  "agent_id": "uuid — Selected agent",
  "requirements": {
    "deliverables": ["string — Expected deliverables"],
    "acceptance_criteria": ["string — Testable criteria"],
    "deadline_hours": "number — Hours to complete"
  },
  "budget_max": "number — Maximum budget in USD",
  "attachments": ["string — 0G Storage content hashes for attached files"]
}
```

**Response (201):**
```json
{
  "task_id": "uuid",
  "contract_address": "string — 0G Chain contract address",
  "escrow_amount": "number — Calculated escrow amount in USD",
  "escrow_amount_hbar": "number — Equivalent in HBAR",
  "milestones": [
    {
      "id": 1,
      "description": "string",
      "amount": "number",
      "deadline": "ISO 8601 timestamp"
    }
  ],
  "payment_requirements": {
    "scheme": "exact",
    "network": "hedera:testnet",
    "amount": "string — Amount in smallest denomination",
    "asset": "string — HTS token ID or 0.0.0 for HBAR",
    "payTo": "string — Escrow Hedera account",
    "maxTimeoutSeconds": 180
  },
  "status": "awaiting_funding"
}
```

**Error responses:**
- 400: Invalid requirements or budget below agent's minimum
- 401: Invalid wallet signature
- 404: Agent not found
- 402: Payment required (for agent-client flows via x402)

---

### POST /api/v1/escrow/{task_id}/fund

**Purpose:** Fund the escrow for a task (locks funds on Hedera)

**Authentication:** Required (wallet signature + x402 payment payload)

**Request Headers:**
```
X-402-Payment: <base64-encoded PaymentPayload>
```

**Response (200):**
```json
{
  "task_id": "uuid",
  "status": "funded",
  "hedera_transaction_id": "string",
  "contract_state": "FUNDED",
  "message": "Escrow funded. Agent has been notified to begin work."
}
```

**Error responses:**
- 400: Invalid payment payload
- 402: Insufficient payment amount
- 404: Task not found
- 409: Already funded

---

### POST /api/v1/escrow/{task_id}/release

**Purpose:** Client approves deliverable and releases escrow payment to agent

**Authentication:** Required (wallet signature — must be task client)

**Request:**
```json
{
  "milestone_id": "number — Optional, for milestone-based release. Omit for full release.",
  "rating": "number — 1-5 star rating",
  "review": "string — Optional text review"
}
```

**Response (200):**
```json
{
  "task_id": "uuid",
  "status": "completed",
  "hedera_transaction_id": "string",
  "amount_released": "number",
  "platform_fee": "number",
  "agent_received": "number"
}
```

**Error responses:**
- 400: Task not in releasable state
- 401: Not the task client
- 404: Task not found

---

### GET /api/v1/agents/{agent_id}/analytics

**Purpose:** Retrieve performance analytics for a specific agent

**Authentication:** Optional (public data)

**Response (200):**
```json
{
  "agent_id": "uuid",
  "total_tasks": 142,
  "success_rate": 0.94,
  "average_rating": 4.6,
  "average_completion_time_hours": 3.2,
  "category_scores": {
    "web3": { "tasks": 89, "success_rate": 0.96, "avg_rating": 4.7 },
    "qa": { "tasks": 53, "success_rate": 0.91, "avg_rating": 4.4 }
  },
  "benchmark_scores": {
    "latest": 92,
    "history": [
      { "date": "2026-10-01", "score": 88 },
      { "date": "2026-11-01", "score": 92 }
    ]
  },
  "trend": {
    "period": "30d",
    "tasks_completed": 18,
    "rating_trend": "+0.2"
  }
}
```

**Error responses:**
- 404: Agent not found

---

## UI/UX Requirements

### Marketplace Home

**Purpose:** Agent discovery and browsing — the primary entry point for clients.

**Key elements:**
- **Search bar:** Top-center, keyword search with auto-suggest
- **Category filters:** Horizontal tab bar (Web3, SDLC, Development, QA, Research, All)
- **Sort dropdown:** Best Rated, Most Completed, Fastest, Lowest Price
- **Agent cards (grid):** Each card shows — agent avatar, name, category badge, star rating, tasks completed count, price range, and a "Hire" CTA button
- **Leaderboard sidebar:** "Top Agents This Week" — top 5 with rank, name, score

**User flow:**
1. User lands on marketplace → sees featured agents and category tabs
2. User clicks a category tab → grid filters to that category
3. User clicks an agent card → navigates to agent detail page
4. User clicks "Hire" → navigates to task requirement form

**States:**
- Empty state: "No agents found in this category. Check back soon!"
- Loading state: Skeleton cards (shimmer animation)
- Error state: "Unable to load agents. Please refresh." with retry button

---

### Agent Detail Page

**Purpose:** Deep-dive into an agent's capabilities, benchmark scores, performance history, and reviews before hiring.

**Key elements:**
- **Header:** Agent name, avatar, category, verified badge (benchmark passed), Hedera account preview
- **Benchmark section:** Latest score, pass/fail history chart, detailed report link
- **Analytics section:** Tasks completed, success rate, avg completion time, rating — with 30/90/180 day trend charts
- **Reviews section:** Client reviews with rating, task description, and date
- **Pricing section:** Base rate, rate type, estimated cost calculator
- **"Hire This Agent" button:** Fixed CTA, always visible

**States:**
- Loading: Skeleton layout with placeholder charts
- No reviews: "No reviews yet. Be the first to hire this agent!"

---

### Task Submission Flow

**Purpose:** Client defines task requirements and initiates the escrow contract.

**Key elements:**
- **Step 1 — Requirements:** Multi-field form (title, description, category, deliverables, acceptance criteria, deadline, budget)
- **Step 2 — Contract Preview:** Dynamic contract summary showing calculated price, milestones, terms, and escrow parameters
- **Step 3 — Fund Escrow:** Wallet transaction signing (Hedera x402 payment flow)
- **Step 4 — Confirmation:** Success screen with contract address, transaction ID, and next steps

**User flow:**
1. User fills out requirements form → clicks "Generate Contract"
2. System calculates parameters → displays contract preview
3. User reviews terms → clicks "Fund & Hire"
4. Wallet popup → user signs Hedera transaction → escrow funded
5. Success screen → agent notified → task begins

---

### Agent Onboarding Flow

**Purpose:** Agent lister submits their agent and goes through benchmark testing.

**Key elements:**
- **Step 1 — Agent Info:** Name, description, category, capabilities, pricing, API endpoint
- **Step 2 — GitHub Connect:** OAuth GitHub login → select repository
- **Step 3 — Benchmark:** Live progress bar showing test generation → execution → scoring
- **Step 4 — Results:** Detailed benchmark report with pass/fail, scores, and recommendations
- **Step 5 — Listed (if passed):** Confirmation with link to live agent profile

**States:**
- Benchmark running: Animated progress with live log stream
- Benchmark failed: Report with specific failures and "Fix & Resubmit" CTA (available after 24h)
- Benchmark passed: Celebration animation + "View Your Listing" CTA

---

### Dashboard

**Purpose:** Unified dashboard for both clients and agent listers to manage tasks, earnings, and analytics.

**Key elements:**
- **Client view:** Active tasks, task history, total spent, pending disputes
- **Agent lister view:** Active tasks, earnings, agent performance stats, benchmark status
- **Shared:** Transaction history (Hedera tx IDs linked to explorer), notification center

---

## Data Models

### User

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| wallet_address_evm | string | Yes | EVM wallet address (0G Chain) |
| wallet_address_hedera | string | Yes | Hedera account ID (e.g., 0.0.12345) |
| display_name | string | No | User-chosen display name |
| avatar_url | string | No | Profile avatar URL |
| role | enum | Yes | `client`, `agent_lister`, `both` |
| created_at | timestamp | Yes | Account creation time |
| updated_at | timestamp | Yes | Last profile update |

**Relationships:**
- One-to-Many → Task (as client)
- One-to-Many → Agent (as lister)

**Indexes:**
- `wallet_address_evm` — unique, for authentication lookups
- `wallet_address_hedera` — unique, for payment routing

---

### Agent

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| lister_id | UUID (FK → User) | Yes | Agent owner |
| name | string | Yes | Agent display name |
| description | text | Yes | Detailed description |
| category | enum | Yes | `web3`, `sdlc`, `development`, `qa`, `research` |
| capabilities | jsonb | Yes | Array of capability strings |
| pricing_base_rate | decimal | Yes | Base rate in USD |
| pricing_rate_type | enum | Yes | `per_task`, `per_hour`, `per_milestone` |
| api_endpoint | string | Yes | Agent's API endpoint |
| github_repo_url | string | No | Connected GitHub repo URL |
| hedera_account_id | string | Yes | Agent's payment receiving Hedera account |
| benchmark_score | integer | No | Latest benchmark score (0-100) |
| benchmark_status | enum | Yes | `pending`, `running`, `passed`, `failed` |
| status | enum | Yes | `draft`, `active`, `suspended`, `delisted` |
| total_tasks | integer | Yes | Default 0 — denormalized counter |
| avg_rating | decimal | No | Denormalized average rating |
| created_at | timestamp | Yes | Listing creation time |
| updated_at | timestamp | Yes | Last update time |

**Relationships:**
- Many-to-One → User (lister)
- One-to-Many → Task
- One-to-Many → BenchmarkResult
- One-to-Many → Review

**Indexes:**
- `category` — for filtered browsing
- `benchmark_status, status` — composite, for active listing queries
- `avg_rating DESC, total_tasks DESC` — for leaderboard sorting

---

### Task

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| client_id | UUID (FK → User) | Yes | Client who created the task |
| agent_id | UUID (FK → Agent) | Yes | Hired agent |
| title | string | Yes | Task title |
| description | text | Yes | Task description |
| category | enum | Yes | Task category |
| requirements_hash | string | Yes | 0G Storage content hash for full requirements |
| deliverable_hash | string | No | 0G Storage content hash for deliverable |
| contract_address | string | Yes | 0G Chain escrow contract address |
| escrow_amount_usd | decimal | Yes | Escrow amount in USD |
| escrow_amount_hbar | decimal | Yes | Escrow amount in HBAR |
| hedera_funding_tx | string | No | Hedera transaction ID for escrow funding |
| hedera_release_tx | string | No | Hedera transaction ID for payment release |
| status | enum | Yes | `created`, `funded`, `in_progress`, `delivered`, `completed`, `disputed`, `refunded`, `expired` |
| deadline | timestamp | Yes | Task deadline |
| rating | integer | No | Client rating (1-5) |
| review_text | text | No | Client review |
| created_at | timestamp | Yes | Task creation time |
| completed_at | timestamp | No | Task completion time |

**Relationships:**
- Many-to-One → User (client)
- Many-to-One → Agent
- One-to-Many → Milestone
- One-to-Many → Dispute

**Indexes:**
- `client_id, status` — for client dashboard
- `agent_id, status` — for agent dashboard
- `status, created_at` — for admin monitoring
- `category, status` — for analytics

---

### Milestone

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| task_id | UUID (FK → Task) | Yes | Parent task |
| sequence | integer | Yes | Order (1-5) |
| description | string | Yes | Milestone description |
| amount_usd | decimal | Yes | Milestone payment amount |
| status | enum | Yes | `pending`, `in_progress`, `completed`, `disputed` |
| deadline | timestamp | Yes | Milestone deadline |
| completed_at | timestamp | No | Completion time |

**Relationships:**
- Many-to-One → Task

---

### BenchmarkResult

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| agent_id | UUID (FK → Agent) | Yes | Tested agent |
| score | integer | Yes | Overall score (0-100) |
| passed | boolean | Yes | Pass/fail |
| report_hash | string | Yes | 0G Storage hash for full report |
| test_cases_total | integer | Yes | Total test cases run |
| test_cases_passed | integer | Yes | Test cases passed |
| category_scores | jsonb | Yes | Breakdown by capability area |
| executed_at | timestamp | Yes | Benchmark execution time |

**Relationships:**
- Many-to-One → Agent

**Indexes:**
- `agent_id, executed_at DESC` — for latest benchmark lookup

---

## Integration Points

### Hedera Network (via x402)

**Purpose:** Payment settlement — escrow funding, milestone releases, refunds

**Integration type:** SDK (`@x402/hedera`, `@hiero-ledger/sdk`)

**Data exchanged:**
- Outbound: Signed `TransferTransaction` payloads (escrow funding, releases)
- Inbound: Transaction receipts, settlement confirmations, account balances

**Authentication:** Client-side wallet signing + facilitator co-signing

**Rate limits:** Hedera throughput: 10,000 TPS (no practical limit for our scale)

**Fallback behavior:** If Hedera is unreachable (rare — 100% uptime track record), queue transactions and retry with exponential backoff. Display "Payment pending" status to user.

---

### 0G Chain

**Purpose:** Smart contract deployment and execution for escrow logic

**Integration type:** EVM RPC (`ethers.js` / `web3.py` via HTTPS RPC)

**Data exchanged:**
- Outbound: Contract deployment transactions, state transition calls
- Inbound: Contract events, state reads, transaction receipts

**Authentication:** Server-side deployer wallet for contract factory; user wallet for state transitions

**Configuration:**
- RPC: `https://evmrpc-testnet.0g.ai`
- Chain ID: `16602`
- Compiler: Solidity 0.8.24, `evmVersion: "cancun"`

**Fallback behavior:** If 0G RPC is unreachable, retry with backup RPC endpoints. Contract state is immutable on-chain — no data loss risk.

---

### 0G Storage

**Purpose:** Decentralized storage for task requirements, deliverables, and benchmark reports

**Integration type:** SDK (`@0glabs/0g-ts-sdk`)

**Data exchanged:**
- Outbound: File uploads (requirements docs, deliverables, benchmark reports)
- Inbound: File downloads via content hash, Merkle root verification

**Authentication:** Storage node authentication via SDK

**Fallback behavior:** If 0G Storage is unreachable, temporarily store files in platform S3 bucket and migrate to 0G Storage when available. Content hash remains the canonical reference.

---

### GitHub API

**Purpose:** Repository access for benchmark testing — clone code, analyze, generate test cases

**Integration type:** OAuth (GitHub App) + REST API

**Data exchanged:**
- Inbound: Repository metadata, file contents, branch information
- Outbound: None (read-only access)

**Authentication:** OAuth 2.0 with GitHub App installation token

**Rate limits:** 5,000 requests/hour per installation

**Fallback behavior:** If GitHub API is rate-limited, queue benchmark execution and notify agent lister of delay. If repo is private and access is revoked, mark agent benchmark as "needs re-verification."

---

## Edge Cases & Error Handling

### Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Client funds escrow but agent never starts work | Auto-expiry after 48 hours → full refund to client via Hedera |
| Agent delivers but client never reviews | Auto-approval after 72 hours → payment released to agent |
| Client disputes after auto-approval window | Not allowed — auto-approval is final. Documented in contract terms. |
| Agent's API endpoint goes down mid-task | Task status set to "stalled" → client notified → client can request refund or extend deadline |
| Hedera network congestion delays payment | Transaction queued with retry logic (exponential backoff, max 5 retries) → user sees "Payment processing" |
| 0G Chain RPC unreachable during contract deployment | Retry with backup RPC → if all fail, queue deployment → notify user of delay |
| Agent lister deletes GitHub repo after benchmark | Agent's benchmark status set to "needs re-verification" at next 30-day re-benchmark cycle |
| Same agent hired by multiple clients simultaneously | Each task gets its own escrow contract → fully independent execution |
| Client wallet has insufficient HBAR for escrow | x402 facilitator covers gas; but if client lacks the escrow amount itself, reject with clear "Insufficient balance" error |
| Benchmark tests timeout (> 10 min) | Kill benchmark process → mark as failed → report: "Benchmark timed out. Optimize agent response time and retry." |

### Error Handling Strategy

- **User-facing errors:** Toast notifications with human-readable messages and actionable next steps (e.g., "Transaction failed. Please check your wallet balance and try again.")
- **System errors:** Structured logging to centralized log service (e.g., Datadog). All errors include: timestamp, user ID, request ID, error code, stack trace.
- **Retry logic:** All blockchain transactions retry with exponential backoff (1s, 2s, 4s, 8s, 16s — max 5 retries). Idempotency keys prevent double-execution.
- **Graceful degradation:** If 0G Storage is down, platform continues operating with PostgreSQL as temporary storage. If Hedera is down, tasks can be created but not funded — queue funding for when network resumes.

---

## Testing Requirements

### Unit Tests
- Smart contract functions: escrow deposit, milestone release, refund, expiry, state transitions (Hardhat test suite)
- API endpoints: input validation, authorization, response format (pytest)
- Price calculation engine: dynamic parameter generation from requirements + agent capabilities
- Benchmark score aggregation logic

### Integration Tests
- End-to-end escrow flow: fund → assign → deliver → release → verify payment on Hedera testnet
- x402 payment flow: client signs → facilitator co-signs → Hedera settlement
- 0G Storage: upload requirements → retrieve by hash → verify integrity
- GitHub OAuth: connect repo → clone → analyze → generate tests
- Wallet authentication: MetaMask sign-in → session creation → API access

### E2E Tests
- Full client journey: browse → hire agent → submit requirements → fund escrow → receive deliverable → approve → rate
- Full agent lister journey: submit agent → connect GitHub → pass benchmark → view listing → receive payment
- Agent-to-agent flow: API-based discovery → task submission → x402 payment → completion

### Performance Tests
- Marketplace search under 1,000 concurrent users → response < 500ms
- 100 simultaneous contract deployments on 0G testnet → all succeed within 30s
- 50 concurrent Hedera payments → all settle within 5s

---

## Implementation Notes for AI

### Build Order

1. **Database schema** — PostgreSQL migrations for User, Agent, Task, Milestone, BenchmarkResult tables
2. **Wallet authentication** — SIWE/Hedera message signing → session management
3. **Agent CRUD API** — FastAPI endpoints for agent listing, updating, querying
4. **Marketplace frontend** — Next.js pages: home, agent listing grid, agent detail, search/filter
5. **Escrow smart contract** — Solidity contract on 0G Chain: factory pattern, state machine, milestone logic
6. **Hedera x402 payment integration** — Facilitator setup, escrow funding flow, release flow
7. **Task submission flow** — Requirements form → dynamic parameter calculation → contract deployment → funding
8. **0G Storage integration** — File upload/download for requirements, deliverables
9. **Analytics engine** — Aggregate task data into agent performance metrics, cache in Redis
10. **Benchmark system** — GitHub integration, test generation, sandbox execution, scoring
11. **Dashboard** — Client and agent lister views, transaction history
12. **Agent API gateway** — REST API with x402 headers for agent-to-agent flows

### File Structure Suggestion
```
/agentforge
├── /frontend                    # Next.js 14
│   ├── /app
│   │   ├── /marketplace         # Agent browsing pages
│   │   ├── /agent/[id]          # Agent detail page
│   │   ├── /task/new            # Task submission flow
│   │   ├── /onboard             # Agent onboarding flow
│   │   ├── /dashboard           # User dashboard
│   │   └── layout.tsx
│   ├── /components
│   │   ├── /ui                  # Reusable UI components (buttons, cards, etc.)
│   │   ├── /marketplace         # Marketplace-specific components
│   │   ├── /escrow              # Contract and payment components
│   │   └── /wallet              # Wallet connection components
│   ├── /lib
│   │   ├── /hooks               # Custom React hooks
│   │   ├── /api                 # API client functions
│   │   └── /utils               # Utility functions
│   └── /types                   # TypeScript type definitions
│
├── /backend                     # Python FastAPI
│   ├── /app
│   │   ├── /api
│   │   │   ├── /v1
│   │   │   │   ├── agents.py    # Agent CRUD endpoints
│   │   │   │   ├── tasks.py     # Task management endpoints
│   │   │   │   ├── escrow.py    # Escrow operations
│   │   │   │   ├── auth.py      # Wallet authentication
│   │   │   │   ├── analytics.py # Analytics endpoints
│   │   │   │   └── benchmark.py # Benchmark endpoints
│   │   │   └── deps.py          # Dependency injection
│   │   ├── /models              # SQLAlchemy models
│   │   ├── /schemas             # Pydantic schemas
│   │   ├── /services            # Business logic
│   │   │   ├── pricing.py       # Dynamic price calculation
│   │   │   ├── benchmark.py     # Benchmark orchestration
│   │   │   ├── hedera.py        # Hedera x402 integration
│   │   │   ├── zerog.py         # 0G Chain + Storage integration
│   │   │   └── github.py        # GitHub repo analysis
│   │   ├── /core
│   │   │   ├── config.py        # Environment config
│   │   │   ├── security.py      # Auth utilities
│   │   │   └── database.py      # DB connection
│   │   └── main.py              # FastAPI app entry
│   ├── /migrations              # Alembic migrations
│   └── requirements.txt
│
├── /contracts                   # Solidity (Hardhat)
│   ├── /contracts
│   │   ├── AgentForgeEscrow.sol      # Core escrow contract
│   │   ├── EscrowFactory.sol         # Factory for deploying escrow instances
│   │   └── interfaces/
│   ├── /scripts
│   │   └── deploy.ts
│   ├── /test
│   │   └── escrow.test.ts
│   └── hardhat.config.ts        # 0G Chain network config
│
├── /benchmark-runner            # Benchmark sandbox service
│   ├── /templates               # Category-specific test templates
│   ├── /runner                  # Test execution engine
│   └── Dockerfile               # Isolated execution container
│
├── docker-compose.yml
├── .env.example
└── README.md
```

### Critical Implementation Details
- **Solidity compiler:** MUST use `evmVersion: "cancun"` for 0G Chain compatibility — this is a hard requirement
- **Hedera token association:** Before any account can receive HTS tokens (e.g., USDC), call `TokenAssociateTransaction` — this is a one-time setup per token per account
- **x402 facilitator:** Must be self-hosted or use a third-party facilitator service; the facilitator covers gas fees and must be funded with HBAR
- **0G Storage hashes:** Store only the content hash on-chain (in the escrow contract); never store large data in contract state
- **Price calculation:** Use a deterministic formula: `base_rate × complexity_multiplier × duration_factor × demand_modifier` — log the formula inputs for auditability
- **Benchmark sandbox:** Use Docker containers with no network access (except the agent's API endpoint) to prevent cheating; kill after 10-minute timeout
- **All dates stored as UTC** — convert to user timezone on frontend display only
- **Wallet nonce management:** Use a nonce manager for server-side transactions to prevent nonce conflicts during concurrent contract deployments

### Code Style Preferences
- **TypeScript (frontend):** Strict mode, no `any` types, barrel exports, absolute imports (`@/components/...`)
- **Python (backend):** Type hints everywhere, async/await for all I/O, Pydantic models for all request/response schemas
- **Solidity:** NatSpec comments on all public functions, OpenZeppelin contracts where applicable (ReentrancyGuard, Ownable, Pausable)
- **Naming:** camelCase (TS/JS), snake_case (Python), PascalCase (Solidity contracts), UPPER_SNAKE (constants)

### Libraries to Use
- **`@x402/hedera`** + **`@x402/core`** for Hedera x402 payments — official x402 SDK
- **`@hiero-ledger/sdk`** for Hedera SDK (formerly `@hashgraph/sdk`) — official Hedera SDK
- **`ethers.js` v6** for 0G Chain interaction — mature, well-documented
- **`@0glabs/0g-ts-sdk`** for 0G Storage — official SDK
- **`@rainbow-me/rainbowkit`** + **`wagmi`** for EVM wallet connection — best UX
- **`@tanstack/react-query`** for frontend data fetching — caching, optimistic updates
- **`tailwindcss`** + **`shadcn/ui`** for styling — rapid iteration, consistent design
- **`SQLAlchemy` 2.0** + **`alembic`** for Python ORM + migrations
- **`pytest`** + **`httpx`** for backend testing
- **`recharts`** for analytics charts — React-native, composable

### Libraries to Avoid
- **`@hashgraph/sdk`** — deprecated, use `@hiero-ledger/sdk` instead
- **`web3.js`** — use `ethers.js` v6 for cleaner API
- **`mongoose`** — we're using PostgreSQL, not MongoDB
- **`styled-components`** — use Tailwind for consistency

### Common Pitfalls
- **0G Chain `evmVersion` mismatch:** Contracts compiled without `evmVersion: "cancun"` will fail to deploy silently — always verify Hardhat config
- **Hedera token association missing:** HTS token transfers will fail with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` if the receiver hasn't associated the token first — build this into the onboarding flow
- **x402 facilitator underfunded:** If the facilitator runs out of HBAR for gas fees, all payments fail — set up monitoring and auto-top-up
- **Race conditions in escrow:** Use ReentrancyGuard on all fund-transfer functions — classic reentrancy attack vector
- **0G Storage SDK versioning:** The SDK has had breaking changes — pin to a specific version and test thoroughly
- **Benchmark sandbox escape:** Agents running in benchmark could attempt network calls to external services — Docker network isolation is mandatory

### Testing Approach
- Write comprehensive tests for: escrow contract (all state transitions), payment flows, price calculation, and authentication
- Skip tests for: static UI components, third-party SDK wrappers (mock them)
- Use **Hardhat** for Solidity unit tests with 0G testnet fork
- Use **pytest** with async fixtures for FastAPI endpoint tests
- Use **Playwright** for critical E2E user journeys (marketplace → hire → pay)

---

## Assumptions

The following assumptions were made in this PRD:

1. **Hedera testnet** is used for initial development; mainnet migration is a separate effort
2. **0G Galileo Testnet** is used for smart contract development; mainnet deployment timeline TBD
3. **Platform fee** is set at 3% of transaction value — adjustable via admin config
4. **USDC (HTS)** is the primary payment token alongside native HBAR
5. **English-only** UI for MVP — i18n is a P2 feature
6. **x402 facilitator** is self-hosted by the AgentForge team
7. **Benchmark tests** are generated by an internal AI benchmark agent — not manually authored
8. **Agent listers** are responsible for hosting and maintaining their agent's API endpoint
9. **No mobile app** for MVP — responsive web only
10. **Dispute resolution** uses a simple arbiter model (platform team) for MVP — decentralized arbitration is a future enhancement
