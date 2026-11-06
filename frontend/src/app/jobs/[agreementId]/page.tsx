"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AuditPanel } from "@/components/AuditPanel";
import { ClaimRefund } from "@/components/ClaimRefund";
import { DemoMoments } from "@/components/DemoMoments";
import { ItemList } from "@/components/BenchmarkReport";
import { Alert, AuditNotice, Badge, Button, Card, ChainStatus, CopyButton, EmptyState, ErrorPanel, HashScanLink, Hbar, Mono, PageSkeleton, QueryError, SeededBadge, VerdictBadge } from "@/components/ui";
import { useApi, useMe } from "@/hooks/useApi";
import { useWallet } from "@/hooks/useWallet";
import { api, type A2aCall, type Agent, type AgreementDetail, type AgreementStatus, type AuditResponse, type PublicConfig, type VerificationResponse } from "@/lib/api";
import { capTinybar, fmtDate, pickCapPercent } from "@/lib/format";

const ORDER: AgreementStatus[] = ["agreed", "funded", "submitted", "verifying"];
const inFlight = (s?: AgreementStatus) => s === "agreed" || s === "funded" || s === "submitted" || s === "verifying";

function Timeline({ d }: { d: AgreementDetail }) {
  const a = d.agreement;
  const settled = a.status === "released" || a.status === "refunded";
  const idx = settled ? 99 : ORDER.indexOf(a.status);
  const pay = (k: string) => d.payments.find((p) => p.kind === k);
  const fund = pay("fund");
  const settle = pay(a.status === "refunded" ? "refund" : "release");
  const rows: { key: string; label: string; at?: string | null; extra?: React.ReactNode; active: string }[] = [
    { key: "agreed", label: "Agreement created", extra: <HashScanLink kind="contract" value={a.escrowAddress} />, at: a.createdAt, active: "" },
    { key: "funded", label: "Escrow funded", at: d.timestamps?.fundedAt ?? fund?.createdAt, extra: <HashScanLink kind="tx" value={fund?.txHash} />, active: "Waiting for the buyer to fund the escrow" },
    { key: "submitted", label: "Work submitted", at: d.timestamps?.submittedAt ?? d.submission?.submittedAt, active: "Waiting for the agent to submit work" },
    { key: "verifying", label: "Verifying", active: "Checking the submitted work against the requirements" },
    { key: "settled", label: a.status === "refunded" ? "Refunded" : "Released", at: d.timestamps?.settledAt ?? settle?.createdAt, extra: <HashScanLink kind="tx" value={settle?.txHash ?? d.verdict?.settleTxHash} />, active: d.verdict ? "Verdict signed, waiting for confirmation of the on-chain payout" : "Waiting for the verdict" },
  ];
  const cur = settled ? rows.length : idx + 1; // first not-done row
  return (
    <ol className="space-y-3" aria-label="Job timeline" aria-live="polite">
      {rows.map((r, i) => {
        const done = i < cur;
        const active = i === cur;
        return (
          <li key={r.key} aria-current={active ? "step" : undefined} className="flex flex-wrap items-center gap-2">
            <span className={done ? "text-success" : active ? "text-warning" : "text-muted-foreground"} aria-hidden>{done ? "✓" : active ? "●" : "○"}</span>
            <span className={done || active ? "font-medium" : "text-muted-foreground"}>{r.label}</span>
            <span className="sr-only">{done ? "done" : active ? "in progress" : "not started"}</span>
            {done && r.at && <span className="text-sm text-muted-foreground">{fmtDate(r.at)}</span>}
            {done && r.extra}
            {active && <span className="text-sm text-muted-foreground">{r.active}</span>}
            {active && (i === 1 || i === 4) && <ChainStatus state="pending" />}
          </li>
        );
      })}
    </ol>
  );
}

export default function JobPage() {
  const { agreementId: id } = useParams<{ agreementId: string }>();
  const qc = useQueryClient();
  const me = useMe();
  const { signedIn } = useWallet(); // the token is sent by api(); the key refetches on sign-in/out
  const who = signedIn ? "user" : "anon";
  const poll = (d?: AgreementDetail) => inFlight(d?.agreement.status);
  const dq = useApi<AgreementDetail>(["agreement", id, who], `/agreements/${id}`, { poll });
  const live = inFlight(dq.data?.agreement.status);
  const vq = useApi<VerificationResponse>(["verification", id, who], `/agreements/${id}/verification`, { poll: () => live });
  const aq = useApi<A2aCall[]>(["a2a", id, who], `/agreements/${id}/a2a`, { poll: () => live });
  const auditQ = useApi<AuditResponse>(["audit", id], `/agreements/${id}/audit`, { poll: () => live });
  const configQ = useApi<PublicConfig>(["config"], "/config");
  const agentQ = useApi<{ agent: Agent }>(["agent", dq.data?.agent.id], dq.data ? `/agents/${dq.data.agent.id}` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ tone: "info" | "warning" | "success"; text: string } | null>(null);
  const [actionErr, setActionErr] = useState<unknown>(null);

  if (dq.isLoading) return <PageSkeleton />;
  if (dq.isError) {
    if (dq.error.status === 404) return <EmptyState title="Job not found" />;
    return <QueryError error={dq.error} title="Could not load the job" onRetry={() => dq.refetch()} />;
  }
  const d = dq.data!;
  const a = d.agreement;
  const isClient = me.data?.id === a.clientUserId;
  const isAgentOwner = Boolean(me.data && agentQ.data && agentQ.data.agent.ownerUserId === me.data.id);
  const latest = vq.data?.latest ?? null;
  const verdict = d.verdict;
  const settled = a.status === "released" || a.status === "refunded";
  const settlePayment = d.payments.find((p) => p.kind === (a.status === "refunded" ? "refund" : "release"));
  const publicView = d.viewerAccess === "public";
  const a2a = aq.data ?? [];
  const spent = a2a.filter((c) => c.status === "paid" || c.status === "done").reduce((s, c) => s + BigInt(c.priceTinybar), 0n);
  const capPercent = pickCapPercent(d.a2aMaxPercent, configQ.data?.a2aMaxPercent);
  const cap = capPercent !== null ? capTinybar(a.priceTinybar, capPercent) : null;
  const canClaimRefund = (isClient || isAgentOwner) && (a.status === "submitted" || a.status === "verifying");
  const pastDeadline = a.status === "funded" && a.deadlineAt && Date.parse(a.deadlineAt) < Date.now();

  async function act(kind: "verify" | "settle") {
    setBusy(kind);
    setActionErr(null);
    setActionMsg(null);
    try {
      const r = await api<{ already?: boolean }>(`/agreements/${id}/${kind}`, { method: "POST", body: {} });
      setActionMsg(r.already ? { tone: "info", text: "Already settled." } : { tone: "success", text: kind === "verify" ? "Verification restarted." : "Payout retried. Waiting for confirmation." });
      await qc.invalidateQueries({ queryKey: ["agreement", id] });
      await qc.invalidateQueries({ queryKey: ["verification", id] });
    } catch (e) {
      setActionErr(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{d.request.title}</h1>
          {d.request.isSeeded && <SeededBadge />}
          <Badge tone={a.status === "released" ? "success" : a.status === "refunded" ? "danger" : "info"}>{a.status}</Badge>
        </div>
        <p className="mt-1 text-sm">
          <Hbar value={a.priceTinybar} /> with <Link className="text-primary underline" href={`/agents/${d.agent.id}`}>{d.agent.name}</Link>
          {a.deadlineAt && <span className="text-muted-foreground"> . Due {fmtDate(a.deadlineAt)}</span>}
        </p>
      </div>

      {(dq.isError || vq.isError || aq.isError) && <p className="text-sm text-warning">Some data could not refresh.</p>}

      {publicView && (
        <Alert tone="info" title="Limited view">
          Submission and raw details are visible to the client and the agent owner only. Hashes, the verdict, nonce, signature and transaction links are shown below.
          {!signedIn && <> <Link className="text-primary underline" href="/connect">Sign in</Link> if you are the client or the agent owner.</>}
        </Alert>
      )}

      <DemoMoments d={d} calls={a2a} capPercent={capPercent} />

      <Card><h2 className="mb-3 text-lg font-semibold">Timeline</h2><Timeline d={d} />
        {pastDeadline && <div className="mt-3"><Alert tone="warning">Past deadline. Refund after deadline is a contract function (not in this app&apos;s scope).</Alert></div>}
        {a.status === "agreed" && isClient && <p className="mt-3 text-sm"><Link className="text-primary underline" href={`/requests/${a.requestId}`}>Fund the escrow to start work</Link></p>}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Submission</h2>
        {d.submission ? (
          <div className="mt-2 space-y-2 text-sm">
            {d.submission.content === undefined || d.submission.redacted ? (
              <p className="text-muted-foreground">Submission and raw details are visible to the client and the agent owner only.</p>
            ) : (
              <>
                {d.submission.kind === "repo" && <p><a className="text-primary underline break-all" href={d.submission.content} target="_blank" rel="noopener noreferrer">{d.submission.content}</a></p>}
                {d.submission.kind === "text" && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3">{d.submission.content}</pre>}
              </>
            )}
            <p>Kind: {d.submission.kind}</p>
            <p>Deliverable hash: <Mono>{d.submission.deliverableHash}</Mono> <CopyButton value={d.submission.deliverableHash} /></p>
            <p className="text-muted-foreground">Submitted {fmtDate(d.timestamps?.submittedAt ?? d.submission.submittedAt)}</p>
          </div>
        ) : (
          <p className="mt-2 text-muted-foreground">{a.status === "agreed" ? "Fund the escrow to start work." : "Waiting for the agent to submit."}</p>
        )}
      </Card>

      {(live && a.status !== "agreed" && a.status !== "funded") || latest ? (
        <Card>
          <h2 className="text-lg font-semibold">Verification</h2>
          <div aria-live="polite">
            {vq.isError && <QueryError error={vq.error} title="Could not load verification" onRetry={() => vq.refetch()} />}
            {!latest && a.status === "verifying" && <p className="mt-2 text-muted-foreground">Checking the submitted work against your requirements...</p>}
            {latest && (
              <div className="mt-2 space-y-2">
                <VerdictBadge result={latest.result} />
                {latest.summary && <p className="text-sm">{latest.summary}</p>}
                {latest.result === "ERROR" ? (
                  <>
                    <ErrorPanel title="Verification could not run" detail={publicView ? undefined : (latest.error ?? undefined)} />
                    <p className="text-sm">This is not a fail. The work was not judged.</p>
                    {isClient && a.status === "submitted" && <Button onClick={() => act("verify")} disabled={busy === "verify"}>{busy === "verify" ? "Retrying..." : "Retry verification"}</Button>}
                  </>
                ) : (
                  <ItemList items={latest.items} />
                )}
                {latest.reportRoot && <p className="text-sm">Report stored on 0G: <Mono>{latest.reportRoot}</Mono></p>}
                <p className="text-xs text-muted-foreground">{fmtDate(latest.createdAt)}</p>
              </div>
            )}
          </div>
          <div className="mt-3"><AuditNotice text={vq.data?.disclaimer || undefined} /></div>
        </Card>
      ) : null}

      {verdict && (
        <Card className={settled ? (a.status === "released" ? "border-success/40 bg-success/10" : "border-danger/40 bg-danger/10") : ""}>
          <h2 className="text-lg font-semibold">Verdict and settlement</h2>
          <div className="mt-2 space-y-2">
            <VerdictBadge result={verdict.result} />
            {settled ? (
              <p className="font-medium">
                {a.status === "released" ? "Released: payment sent to the agent" : "Refunded to you"}
                {settlePayment && <> (<Hbar value={settlePayment.amountTinybar} />)</>}
              </p>
            ) : (
              <p className="flex flex-wrap items-center gap-2 text-sm"><ChainStatus state="pending" /> Verdict signed, waiting for confirmation of the on-chain payout</p>
            )}
            <HashScanLink kind="tx" value={verdict.settleTxHash ?? settlePayment?.txHash} />
            {verdict.settleError && !settled && !publicView && (
              <>
                <ErrorPanel title="The payout transaction failed" detail={verdict.settleError} />
                {(isClient || isAgentOwner) && <Button onClick={() => act("settle")} disabled={busy === "settle"}>{busy === "settle" ? "Retrying..." : "Retry payout"}</Button>}
              </>
            )}
          </div>
        </Card>
      )}
      {canClaimRefund && <ClaimRefund agreementId={id} />}
      <AuditPanel d={d} latest={latest} auditEntries={auditQ.data?.entries ?? null} audit={auditQ.data ?? null} />
      {auditQ.isError && <QueryError error={auditQ.error} title="Could not load the signature audit log" onRetry={() => auditQ.refetch()} />}
      {actionMsg && <Alert tone={actionMsg.tone}>{actionMsg.text}</Alert>}
      {actionErr ? <QueryError error={actionErr} title="Action failed" /> : null}

      <Card>
        <h2 className="text-lg font-semibold">Payments</h2>
        {d.payments.length === 0 ? <p className="mt-2 text-muted-foreground">No payments yet.</p> : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Payments for this job</caption>
              <thead className="bg-surface-2"><tr><th className="p-2">Kind</th><th className="p-2">Amount</th><th className="p-2">Status</th><th className="p-2">Transaction</th><th className="p-2">Time</th></tr></thead>
              <tbody>
                {d.payments.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="p-2">{p.kind}</td>
                    <td className="p-2"><Hbar value={p.amountTinybar} /></td>
                    <td className="p-2"><ChainStatus state={p.status} /></td>
                    <td className="p-2">{p.txHash ? <HashScanLink kind="tx" value={p.txHash} /> : <span className="text-muted-foreground">pending</span>}</td>
                    <td className="p-2">{fmtDate(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Agent-to-agent calls</h2>
        {aq.isError && <QueryError error={aq.error} title="Could not load A2A calls" onRetry={() => aq.refetch()} />}
        {aq.data && a2a.length === 0 && <p className="mt-2 text-muted-foreground">No agent-to-agent calls in this job.</p>}
        {a2a.length > 0 && (
          <>
            <p className="mt-2 text-sm">Paid so far <Hbar value={spent.toString()} />{cap !== null && capPercent !== null ? <> of a cap of <Hbar value={cap.toString()} /> ({capPercent}% of the job price)</> : null}.</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Agent-to-agent calls</caption>
                <thead className="bg-surface-2"><tr><th className="p-2">Caller</th><th className="p-2">Callee</th><th className="p-2">Price</th><th className="p-2">Rail</th><th className="p-2">Status</th><th className="p-2">Depth</th></tr></thead>
                <tbody>
                  {a2a.map((c) => (
                    <tr key={c.id} className="border-t border-border align-top">
                      <td className="p-2">{c.callerName ?? "Agent"}</td>
                      <td className="p-2">{c.calleeName ?? "Agent"}</td>
                      <td className="p-2"><Hbar value={c.priceTinybar} /></td>
                      <td className="p-2"><Badge tone="info">{c.rail}</Badge></td>
                      <td className="p-2">
                        <Badge tone={c.status === "blocked" ? "warning" : c.status === "done" ? "success" : c.status === "failed" ? "danger" : c.status === "paid" ? "info" : "neutral"}>
                          {c.status === "blocked" ? "⛔ blocked" : c.status}
                        </Badge>
                        {c.status === "blocked" && <p className="mt-1 text-warning">Blocked: {c.blockedReason ?? "no reason given"}</p>}
                        {(c.status === "paid" || c.status === "done") && c.txHash && (
                          <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">Matched transaction: <HashScanLink kind="tx" value={c.txHash} /></p>
                        )}
                      </td>
                      <td className="p-2">{c.depth}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">The Payments table above is the authoritative list of transactions. A &quot;matched transaction&quot; is paired to a call by amount and order, so it can be wrong when two calls cost the same.</p>
          </>
        )}
      </Card>
      <AuditNotice />
    </div>
  );
}
