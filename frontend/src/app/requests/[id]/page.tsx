"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { FundPanel } from "@/components/FundPanel";
import { AuditNotice, Alert, Badge, Button, ButtonLink, Card, EmptyState, ErrorPanel, Hbar, Loading, PageSkeleton, QueryError, SeededBadge } from "@/components/ui";
import { useApi, useMe } from "@/hooks/useApi";
import { api, ApiError, type AcceptResponse, type Agreement, type Quote, type RequestJob } from "@/lib/api";
import { fmtDate, scoreText } from "@/lib/format";

export default function RequestPage() {
  const { id } = useParams<{ id: string }>();
  const [pollUntil] = useState(() => Date.now() + 60_000);
  const q = useApi<{ request: RequestJob; quotes: Quote[] }>(["request", id], `/requests/${id}`, {
    poll: (d) => !!d && d.request.status === "open" && d.quotes.length === 0 && Date.now() < pollUntil,
  });
  const me = useMe();
  const agreements = useApi<Agreement[]>(["agreements"], me.data ? "/agreements" : null);
  const [confirm, setConfirm] = useState<Quote | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptErr, setAcceptErr] = useState<unknown>(null);
  const [accepted, setAccepted] = useState<AcceptResponse | null>(null);

  if (q.isLoading) return <PageSkeleton />;
  if (q.isError) {
    if (q.error.status === 404) return <EmptyState title="Request not found" action={<ButtonLink href="/">Marketplace</ButtonLink>} />;
    return <QueryError error={q.error} title="Could not load request" onRetry={() => q.refetch()} />;
  }
  const { request, quotes } = q.data!;
  const isClient = me.data?.id === request.clientUserId;
  const agreement = accepted ?? agreements.data?.find((a) => a.requestId === request.id) ?? null;

  async function accept() {
    if (!confirm) return;
    setAccepting(true);
    setAcceptErr(null);
    try {
      const r = await api<AcceptResponse>(`/quotes/${confirm.id}/accept`, { method: "POST", body: {} });
      setAccepted(r);
      setConfirm(null);
      void q.refetch();
    } catch (e) {
      setAcceptErr(e);
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{request.title}</h1>
          {request.isSeeded && <SeededBadge />}
          <Badge tone={request.status === "open" ? "info" : "neutral"}>{request.status}</Badge>
        </div>
        <p className="mt-2 whitespace-pre-wrap">{request.requirements}</p>
        <div className="mt-3 flex flex-wrap gap-1">{request.checksRequested.map((c) => <Badge key={c}>{c}</Badge>)}</div>
        <p className="mt-3 text-sm">Budget <Hbar value={request.budgetTinybar} />. Deadline {fmtDate(request.deadlineAt)}.</p>
      </Card>

      {agreement ? (
        <>
          {accepted?.escrowError && <Alert tone="warning" title="Escrow not created yet">{accepted.escrowError}</Alert>}
          <FundPanel agreementId={agreement.id} />
        </>
      ) : (
        <section aria-labelledby="quotes-h" className="space-y-3">
          <h2 id="quotes-h" className="text-xl font-semibold">Quotes</h2>
          {quotes.length === 0 && request.status === "open" && (
            <>
              <Loading text="Asking listed agents for quotes..." />
              <Button variant="secondary" onClick={() => q.refetch()}>Check again</Button>
            </>
          )}
          <ul className="space-y-3">
            {quotes.map((qt) => {
              const over = BigInt(qt.priceTinybar) > BigInt(request.budgetTinybar);
              return (
                <li key={qt.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{qt.agentName ?? "Agent"} {qt.latestScore != null && <span className="text-sm text-muted-foreground">Benchmark {scoreText(qt.latestScore)} / 100</span>}</p>
                      <p className="text-sm"><Hbar value={qt.priceTinybar} /> {over && <Badge tone="warning">Over budget</Badge>} <span className="text-muted-foreground">{qt.etaHours != null ? `${qt.etaHours} hours` : "ETA not given"}</span></p>
                      <Link className="text-sm text-primary underline" href={`/agents/${qt.agentId}`}>View agent</Link>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge>{qt.status}</Badge>
                      {isClient && qt.status === "open" && request.status === "open" && <Button onClick={() => setConfirm(qt)}>Accept this quote</Button>}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
          {!isClient && me.data && <p className="text-sm text-muted-foreground">Only the buyer can accept a quote.</p>}
        </section>
      )}

      {confirm && (
        <div role="dialog" aria-modal="true" aria-labelledby="dlg-h" className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md space-y-3 rounded-lg bg-surface p-6 shadow-md">
            <h2 id="dlg-h" className="text-lg font-semibold">Accept this quote?</h2>
            <p>{confirm.agentName ?? "Agent"} for <Hbar value={confirm.priceTinybar} />.</p>
            <p className="text-sm">Funds stay in a per-job escrow contract until the automated check decides. PASS pays the agent; FAIL refunds you.</p>
            <AuditNotice />
            {acceptErr ? <QueryError error={acceptErr} title="Could not accept" /> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" autoFocus onClick={() => setConfirm(null)}>Cancel</Button>
              <Button onClick={accept} disabled={accepting}>{accepting ? "Accepting..." : "Confirm"}</Button>
            </div>
          </div>
        </div>
      )}
      {!isClient && !me.data && <p className="text-sm text-muted-foreground"><Link className="text-primary underline" href="/connect">Sign in</Link> to accept a quote.</p>}
      {agreements.isError && !(agreements.error instanceof ApiError && agreements.error.status === 401) && <ErrorPanel title="Could not check for an existing agreement" onRetry={() => agreements.refetch()} />}
    </div>
  );
}
