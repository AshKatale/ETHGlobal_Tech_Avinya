import { BACKEND_URL } from "./chain";
import { getToken, setToken } from "./session";

// Types follow docs/contracts/api.md exactly. Money fields are tinybar strings.

export type AgentStatus = "draft" | "benchmarking" | "listed" | "failed";
export interface Agent {
  id: string;
  ownerUserId: string;
  name: string;
  description: string;
  capabilities: string[];
  endpointUrl: string | null;
  payoutAddress: string;
  hederaAccountId: string | null;
  priceTinybar: string;
  repoUrl: string | null;
  repoCommit: string | null;
  status: AgentStatus;
  latestBenchmarkId: string | null;
  isSeeded: boolean;
  createdAt: string;
  /** Score of the latest benchmark run (numeric string) or null. Optional for graceful fallback. */
  latestScore?: string | null;
}
export interface BenchmarkRun {
  id: string;
  agentId: string;
  repoUrl: string;
  repoCommit: string | null;
  status: "running" | "passed" | "failed" | "error";
  customScore: string | null;
  aiScore: string | null;
  score: string | null;
  reviewText: string | null;
  items: unknown;
  error: string | null;
  reportRoot: string | null;
  createdAt: string;
}
export interface RequestJob {
  id: string;
  clientUserId: string;
  title: string;
  requirements: string;
  checksRequested: string[];
  budgetTinybar: string;
  deadlineAt: string | null;
  status: "open" | "agreed" | "closed";
  isSeeded: boolean;
  createdAt: string;
}
export interface Quote {
  id: string;
  requestId: string;
  agentId: string;
  priceTinybar: string;
  etaHours: number | null;
  status: "open" | "accepted" | "rejected";
  createdAt: string;
  agentName?: string | null;
  latestScore?: string | null;
}
export type AgreementStatus = "agreed" | "funded" | "submitted" | "verifying" | "released" | "refunded";
export interface Agreement {
  id: string;
  requestId: string;
  quoteId: string;
  clientUserId: string;
  agentId: string;
  priceTinybar: string;
  deadlineAt: string | null;
  escrowAddress: string | null;
  status: AgreementStatus;
  createdAt: string;
}
export interface AgreementTimestamps {
  fundedAt: string | null;
  submittedAt: string | null;
  settledAt: string | null;
}
export type ViewerAccess = "full" | "public";
export type AcceptResponse = Agreement & { escrowError?: string };
export interface Payment {
  id: string;
  agreementId: string;
  kind: "fund" | "release" | "refund" | "a2a";
  amountTinybar: string;
  txHash: string | null;
  hederaTxId: string | null;
  status: "pending" | "confirmed" | "failed";
  createdAt: string;
}
export interface Submission {
  id: string;
  agreementId: string;
  content: string;
  kind: "text" | "repo";
  deliverableHash: string;
  submittedAt: string;
}
export interface Verdict {
  id: string;
  agreementId: string;
  result: "PASS" | "FAIL";
  verifierSig: string | null;
  nonce: string | null;
  settleTxHash: string | null;
  settleError: string | null;
  createdAt: string;
}
export interface AgreementDetail {
  agreement: Agreement;
  request: RequestJob;
  agent: { id: string; name: string; payoutAddress: string };
  /** In the public view `content` is absent and `redacted` is true. */
  submission: (Omit<Submission, "content"> & { content?: string; redacted?: boolean }) | null;
  verdict: Verdict | null;
  payments: Payment[];
  timestamps?: AgreementTimestamps;
  a2aMaxPercent?: number;
  viewerAccess?: ViewerAccess;
}
export interface AuditEntry {
  id: string;
  kind: "verdict" | "delegation";
  agreementId: string;
  escrowAddress: string | null;
  signerAddress: string;
  nonce: string;
  resultOrAmount: string;
  sigSha256: string;
  createdAt: string;
}
export interface AuditResponse {
  agreementId: string;
  escrowAddress: string | null;
  entries: AuditEntry[];
  verdict: { result: string; nonce: string | null; signature: string | null; settleTxHash: string | null } | null;
  settleTxHash: string | null;
  reportRoot: string | null;
  deliverableHash: string | null;
}
export interface PublicConfig {
  a2aMaxPercent: number;
  minDeadlineMinutes: number;
  defaultDeadlineDays: number;
  benchmarkPassScore: number;
  chainId: number;
}
export interface RefundTimeoutResponse {
  txHash?: string;
  result?: "refund_timeout";
  already?: boolean;
  inProgress?: boolean;
}
export interface Verification {
  id: string;
  agreementId: string;
  result: "PASS" | "FAIL" | "ERROR";
  items: unknown;
  summary: string | null;
  error: string | null;
  reportRoot: string | null;
  createdAt: string;
}
export interface VerificationResponse {
  status: string;
  latest: Verification | null;
  history: Verification[];
  verdict: Verdict | null;
  viewerAccess?: ViewerAccess;
  disclaimer: string;
}
export interface A2aCall {
  id: string;
  agreementId: string;
  callerAgentId: string;
  calleeAgentId: string;
  priceTinybar: string;
  rail: "delegate" | "x402";
  status: "quoted" | "blocked" | "paid" | "done" | "failed";
  blockedReason: string | null;
  depth: number;
  createdAt: string;
  callerName?: string | null;
  calleeName?: string | null;
  /** Matched by amount in creation order, so it is a best guess. */
  txHash?: string | null;
}
export interface Me {
  id: string;
  address: string;
  displayName: string | null;
  hederaAccountId: string | null;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: { path: (string | number)[]; message: string }[],
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
  /** Network failure, 5xx or 502: our side, never a verdict on the user's work. */
  get isInfra() {
    return this.status === 0 || this.status >= 500;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Could not reach the AgentForge backend.");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; issues?: { path: (string | number)[]; message: string }[] };
    if (res.status === 401 && token && !path.startsWith("/auth/")) setToken(null);
    throw new ApiError(res.status, d.error ?? `Request failed (${res.status})`, d.issues, (data ?? undefined) as Record<string, unknown> | undefined);
  }
  return data as T;
}
