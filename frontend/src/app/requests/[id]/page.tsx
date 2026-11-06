'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorText } from '@/lib/api';
import { fmtHbar } from '@/lib/money';
import { ago, dateShort } from '@/lib/format';
import { prettyTag } from '@/lib/agents';
import { useMe } from '@/lib/queries';
import { CHECKS, type Agreement, type JobRequest, type JobRow, type Quote, type TermsPreview } from '@/lib/types';
import { useSession } from '@/providers/Session';
import { useToast } from '@/providers/Toasts';
import Avatar from '@/components/Avatar';
import ContractDesign from '@/components/ContractDesign';
import Notice, { Empty } from '@/components/Notice';

type RequestDetail = { request: JobRequest; quotes: Quote[] };

export default function RequestPage() {
  const { id } = useParams<{ id: string }>();
  const preferred = useSearchParams().get('agent');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = useSession();
  const me = useMe();

  const q = useQuery({
    queryKey: ['request', id],
    queryFn: () => api<RequestDetail>(`/requests/${id}`),
    // Agents answer in the background, so keep looking while the request is open.
    refetchInterval: (query) => (query.state.data?.request.status === 'open' ? 4000 : false),
  });

  const [accepting, setAccepting] = useState<string>();
  const [asking, setAsking] = useState(false);
  const [terms, setTerms] = useState<Record<string, { loading?: boolean; data?: TermsPreview; error?: string }>>({});

  const request = q.data?.request;
  const isClient = !!me.data && !!request && me.data.id === request.clientUserId;

  // Once a quote is accepted, find the job it became.
  const job = useQuery({
    queryKey: ['job-for-request', id],
    queryFn: async () => (await api<(JobRow & { requestId: string })[]>('/agreements', { auth: true })).find((a) => a.requestId === id) ?? null,
    enabled: session.signedIn && request?.status === 'agreed',
  });

  if (q.isLoading) return <div className="page"><div className="container"><div className="skel" style={{ height: 140, marginBottom: 20 }} /><div className="skel" style={{ height: 320 }} /></div></div>;
  if (q.error || !q.data || !request) return <div className="page"><div className="container"><Empty title="Job not found">It may have been removed.<br /><Link className="btn btn-outline btn-sm" href="/marketplace">Back to marketplace</Link></Empty></div></div>;

  const budget = BigInt(request.budgetTinybar);
  const quotes = [...q.data.quotes].sort((a, b) => (BigInt(a.priceTinybar) < BigInt(b.priceTinybar) ? -1 : 1));
  const open = request.status === 'open';

  async function askAgain() {
    setAsking(true);
    try {
      const r = await api<{ asked: number; quoted: number; declined: number; failed: number }>(`/requests/${id}/request-quotes`, { auth: true, method: 'POST', body: {} });
      toast('Agents asked', `${r.asked} asked · ${r.quoted} new quote${r.quoted === 1 ? '' : 's'} · ${r.declined} declined · ${r.failed} unreachable`, 'info');
      qc.invalidateQueries({ queryKey: ['request', id] });
    } catch (e) { toast('Could not ask the agents', apiErrorText(e), 'bad'); }
    setAsking(false);
  }

  async function preview(quoteId: string) {
    setTerms((t) => ({ ...t, [quoteId]: { loading: true } }));
    try {
      const data = await api<TermsPreview>(`/quotes/${quoteId}/terms`, { auth: true, method: 'POST', body: {} });
      setTerms((t) => ({ ...t, [quoteId]: { data } }));
    } catch (e) { setTerms((t) => ({ ...t, [quoteId]: { error: apiErrorText(e) } })); }
  }

  async function accept(quote: Quote) {
    setAccepting(quote.id);
    try {
      const a = await api<Agreement>(`/quotes/${quote.id}/accept`, { auth: true, method: 'POST', body: {} });
      if (a.escrowError) toast('Quote accepted', 'The contract is not deployed yet. You can retry on the next page.', 'info');
      router.push(`/jobs/${a.id}`);
    } catch (e) {
      toast('Could not accept the quote', apiErrorText(e), 'bad');
      setAccepting(undefined);
    }
  }

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 960 }}>
        <nav className="crumbs"><Link href="/marketplace">Marketplace</Link><span>/</span><span>Job request</span></nav>
        <div className="page-head"><div>
          <p className="eyebrow-p">{open ? 'Collecting quotes' : request.status === 'agreed' ? 'Quote accepted' : 'Closed'}</p>
          <h1>{request.title}</h1>
        </div></div>

        <div className="grid g-side">
          <div className="stack">
            <div className="card">
              <h3>Quotes {open && <small>updating automatically</small>}</h3>
              {quotes.length === 0 ? (
                <div className="stack" style={{ gap: 14 }}>
                  {open && <div className="row" style={{ gap: 12 }}><span className="ico-run" style={{ width: 24, height: 24 }} /><span className="muted">Asking listed agents for a quote. Answers usually arrive within a few seconds.</span></div>}
                  <p className="muted" style={{ fontSize: 14 }}>No quotes yet. Agents without a public endpoint cannot be asked automatically; their owners can quote from the API.</p>
                  {isClient && open && <div><button className="btn btn-outline btn-sm" onClick={askAgain} disabled={asking}>{asking ? 'Asking…' : 'Ask agents again'}</button></div>}
                </div>
              ) : (
                <div className="stack" style={{ gap: 14 }}>
                  {quotes.map((qt) => {
                    const over = BigInt(qt.priceTinybar) > budget;
                    const t = terms[qt.id];
                    const name = qt.agent?.name ?? 'Agent';
                    const done = (qt.agent?.jobsCompleted ?? 0) + (qt.agent?.jobsFailed ?? 0);
                    return (
                      <div key={qt.id} className="card" style={{ background: 'var(--card-2)', borderColor: preferred && qt.agentId === preferred ? 'var(--primary-25)' : undefined }}>
                        <div className="row between wrap" style={{ gap: 14 }}>
                          <div className="row" style={{ gap: 12, minWidth: 0 }}>
                            <Avatar name={name} />
                            <div style={{ minWidth: 0 }}>
                              <Link className="link" href={`/agents/${qt.agentId}`} style={{ fontWeight: 600 }}>{name}</Link>
                              {preferred && qt.agentId === preferred && <span className="tag" style={{ marginLeft: 8 }}>your pick</span>}
                              <div className="muted" style={{ fontSize: 13 }}>
                                {qt.agent?.score != null ? `Benchmark ${Math.round(qt.agent.score)}/100` : 'No benchmark'} · {done ? `${qt.agent?.jobsCompleted}/${done} jobs passed` : 'No jobs yet'}{qt.etaHours ? ` · about ${qt.etaHours}h` : ''}
                              </div>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div className="price" style={{ fontSize: 24 }}>{fmtHbar(qt.priceTinybar)}</div>
                            {over && <span className="status s-warn">over your budget</span>}
                          </div>
                        </div>
                        {qt.agent?.capabilities?.length ? <div className="tags" style={{ marginTop: 10 }}>{qt.agent.capabilities.map((c) => <span key={c} className="tag">{prettyTag(c)}</span>)}</div> : null}

                        {t?.data && (
                          <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                            <ContractDesign mode="preview" requirements={request.requirements} requestedChecks={request.checksRequested}
                              agent={{ name, capabilities: qt.agent?.capabilities ?? [] }} spec={t.data.spec} source={t.data.source} specHash={t.data.specHash} />
                          </div>
                        )}
                        {t?.error && <Notice kind="warn" style={{ marginTop: 12 }}>Could not preview the terms. {t.error}</Notice>}

                        {isClient && open && (
                          <div className="row wrap" style={{ gap: 10, marginTop: 14 }}>
                            <button className="btn btn-primary" onClick={() => accept(qt)} disabled={!!accepting || over}>
                              {accepting === qt.id ? 'Creating the contract…' : 'Accept quote'}
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => preview(qt.id)} disabled={t?.loading || !!accepting}>{t?.loading ? 'Designing…' : t?.data ? 'Refresh terms' : 'Preview contract terms'}</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {accepting && <Notice>Designing the contract terms and deploying the contract on Hedera. This can take up to a minute. Keep this page open.</Notice>}
                  {isClient && open && !accepting && <div><button className="btn btn-ghost btn-sm" onClick={askAgain} disabled={asking}>{asking ? 'Asking…' : 'Ask agents again'}</button></div>}
                </div>
              )}
            </div>

            {request.status === 'agreed' && (
              <Notice kind="ok">A quote was accepted. {job.data ? <Link className="link" href={`/jobs/${job.data.id}`}>Open the job</Link> : isClient ? 'Finding the job…' : 'Only the client can open the job.'}</Notice>
            )}
          </div>

          <aside className="stack">
            <div className="card">
              <dl className="kv">
                <dt>Budget</dt><dd>{fmtHbar(request.budgetTinybar)}</dd>
                <dt>Deadline</dt><dd>{request.deadlineAt ? dateShort(request.deadlineAt) : 'None'}</dd>
                <dt>Posted</dt><dd>{ago(request.createdAt)}</dd>
                <dt>Extra checks</dt><dd>{request.checksRequested.length ? request.checksRequested.map((k) => CHECKS.find((c) => c.key === k)?.label ?? k).join(', ') : 'None'}</dd>
              </dl>
              <div className="divider" />
              <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Requirements</div>
              <p style={{ whiteSpace: 'pre-wrap', fontSize: 14.5 }}>{request.requirements}</p>
            </div>
            {!isClient && session.signedIn && <Notice>Only the client who posted this can accept a quote.</Notice>}
          </aside>
        </div>
      </div>
    </div>
  );
}
