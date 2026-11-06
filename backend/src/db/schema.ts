import {
  pgTable, uuid, text, timestamp, numeric, integer, boolean, jsonb, bigint, uniqueIndex, primaryKey,
} from 'drizzle-orm/pg-core';

// Money columns hold tinybar. numeric(38,0) returns strings; convert with BigInt() in code.
const money = (name: string) => numeric(name, { precision: 38, scale: 0 });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  address: text('address').notNull().unique(), // lowercased 0x address
  displayName: text('display_name'),
  hederaAccountId: text('hedera_account_id'),
  createdAt: createdAt(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // random token, used as bearer
  userId: uuid('user_id').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const authNonces = pgTable('auth_nonces', {
  address: text('address').notNull(),
  nonce: text('nonce').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  used: boolean('used').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.address, t.nonce] })]);

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  description: text('description').notNull(),
  capabilities: text('capabilities').array().notNull().default([]),
  endpointUrl: text('endpoint_url'),
  payoutAddress: text('payout_address').notNull(),
  hederaAccountId: text('hedera_account_id'),
  priceTinybar: money('price_tinybar').notNull().default('0'),
  repoUrl: text('repo_url'),
  repoCommit: text('repo_commit'),
  apiKeyHash: text('api_key_hash').notNull(),
  status: text('status').notNull().default('draft'), // draft | benchmarking | listed | failed
  latestBenchmarkId: uuid('latest_benchmark_id'),
  isSeeded: boolean('is_seeded').notNull().default(false),
  createdAt: createdAt(),
});

export const benchmarkRuns = pgTable('benchmark_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  repoUrl: text('repo_url').notNull(),
  repoCommit: text('repo_commit'),
  status: text('status').notNull().default('running'), // running | passed | failed | error
  customScore: numeric('custom_score', { precision: 5, scale: 2 }),
  aiScore: numeric('ai_score', { precision: 5, scale: 2 }),
  score: numeric('score', { precision: 5, scale: 2 }),
  reviewText: text('review_text'),
  items: jsonb('items'),
  error: text('error'),
  reportRoot: text('report_root'),
  createdAt: createdAt(),
});

export const requests = pgTable('requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientUserId: uuid('client_user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  requirements: text('requirements').notNull(),
  checksRequested: text('checks_requested').array().notNull().default([]),
  budgetTinybar: money('budget_tinybar').notNull(),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }),
  status: text('status').notNull().default('open'), // open | agreed | closed
  isSeeded: boolean('is_seeded').notNull().default(false),
  createdAt: createdAt(),
});

export const quotes = pgTable('quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull().references(() => requests.id),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  priceTinybar: money('price_tinybar').notNull(),
  etaHours: integer('eta_hours'),
  status: text('status').notNull().default('open'), // open | accepted | rejected
  createdAt: createdAt(),
});

export const agreements = pgTable('agreements', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull().references(() => requests.id),
  quoteId: uuid('quote_id').notNull().references(() => quotes.id),
  clientUserId: uuid('client_user_id').notNull().references(() => users.id),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  priceTinybar: money('price_tinybar').notNull(),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }),
  escrowAddress: text('escrow_address'), // the TaskEscrow contract address
  taskAccountId: text('task_account_id'), // its Hedera account id (the x402 payTo for funding)
  taskDispatchStatus: text('task_dispatch_status'), // sent | failed | no_endpoint: was the agent told to start work
  taskDispatchError: text('task_dispatch_error'),
  taskDispatchedAt: timestamp('task_dispatched_at', { withTimezone: true }),
  // agreed | funded | submitted | verifying | released | refunded
  status: text('status').notNull().default('agreed'),
  createdAt: createdAt(),
});

export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agreementId: uuid('agreement_id').notNull().references(() => agreements.id),
  content: text('content').notNull(), // inline text, or repo URL when kind = 'repo'
  kind: text('kind').notNull().default('text'), // text | repo
  deliverableHash: text('deliverable_hash').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable('verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  agreementId: uuid('agreement_id').notNull().references(() => agreements.id),
  result: text('result').notNull(), // PASS | FAIL | ERROR
  items: jsonb('items'),
  summary: text('summary'),
  error: text('error'),
  reportRoot: text('report_root'),
  createdAt: createdAt(),
});

export const verdicts = pgTable('verdicts', {
  id: uuid('id').primaryKey().defaultRandom(),
  agreementId: uuid('agreement_id').notNull().references(() => agreements.id).unique(),
  result: text('result').notNull(), // PASS | FAIL
  verifierSig: text('verifier_sig'),
  nonce: bigint('nonce', { mode: 'bigint' }),
  settleTxHash: text('settle_tx_hash'),
  settleError: text('settle_error'),
  createdAt: createdAt(),
});

export const a2aCalls = pgTable('a2a_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  agreementId: uuid('agreement_id').notNull().references(() => agreements.id),
  callerAgentId: uuid('caller_agent_id').notNull().references(() => agents.id),
  calleeAgentId: uuid('callee_agent_id').notNull().references(() => agents.id),
  priceTinybar: money('price_tinybar').notNull(),
  rail: text('rail').notNull().default('delegate'), // delegate | x402
  status: text('status').notNull(), // quoted | blocked | paid | done | failed
  blockedReason: text('blocked_reason'),
  depth: integer('depth').notNull().default(1),
  createdAt: createdAt(),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  agreementId: uuid('agreement_id').notNull().references(() => agreements.id),
  kind: text('kind').notNull(), // fund | release | refund | a2a
  amountTinybar: money('amount_tinybar').notNull(),
  txHash: text('tx_hash'),
  hederaTxId: text('hedera_tx_id'),
  payerAccountId: text('payer_account_id'),
  status: text('status').notNull().default('pending'), // pending | confirmed | failed
  createdAt: createdAt(),
});

export const chainEvents = pgTable('chain_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  contract: text('contract').notNull(),
  event: text('event').notNull(),
  txHash: text('tx_hash').notNull(),
  logIndex: integer('log_index').notNull(),
  consensusTs: text('consensus_ts').notNull(),
  args: jsonb('args'),
}, (t) => [uniqueIndex('chain_events_tx_log').on(t.txHash, t.logIndex)]);

export const chainCursor = pgTable('chain_cursor', {
  contract: text('contract').primaryKey(),
  lastConsensusTs: text('last_consensus_ts').notNull(),
});

// Terms designed by the Solidity agent for a task contract (root) or a sub-leg.
export const contractSpecs = pgTable('contract_specs', {
  id: uuid('id').primaryKey().defaultRandom(),
  quoteId: uuid('quote_id').references(() => quotes.id),
  agreementId: uuid('agreement_id').references(() => agreements.id),
  kind: text('kind').notNull().default('root'), // root | sub
  spec: jsonb('spec').notNull(),
  specHash: text('spec_hash').notNull(),
  trustScore: numeric('trust_score', { precision: 5, scale: 1 }),
  source: text('source').notNull(), // ai | fallback
  deployTx: text('deploy_tx'),
  createdAt: createdAt(),
});

// A -> B legs inside a task contract. A owes B after the task is released and pays over x402.
export const subLegs = pgTable('sub_legs', {
  id: uuid('id').primaryKey().defaultRandom(),
  agreementId: uuid('agreement_id').notNull().references(() => agreements.id),
  legId: integer('leg_id').notNull(), // index inside the contract (0 is the client leg)
  calleeAgentId: uuid('callee_agent_id').notNull().references(() => agents.id),
  payeeAddress: text('payee_address').notNull(),
  payeeAccountId: text('payee_account_id').notNull(), // Hedera account id: x402 payTo
  priceTinybar: money('price_tinybar').notNull(),
  termsHash: text('terms_hash').notNull(),
  status: text('status').notNull().default('pending'), // pending | paid | defaulted
  payoutTx: text('payout_tx'), // Hedera tx id of the x402 settlement
  addLegTx: text('add_leg_tx'),
  a2aCallId: uuid('a2a_call_id'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('sub_legs_agreement_leg').on(t.agreementId, t.legId)]);
