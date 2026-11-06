'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiErrorText } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { hbarToTinybar, tinybarToInput } from '@/lib/money';
import { prettyTag, CODE_CHECKS } from '@/lib/agents';
import { useAgent, useGithubRepos, useGithubStatus, useMe } from '@/lib/queries';
import { TAGS, type Agent, type Benchmark } from '@/lib/types';
import { useSession } from '@/providers/Session';
import { useToast } from '@/providers/Toasts';
import Stepper from '@/components/Stepper';
import Notice from '@/components/Notice';
import Meter from '@/components/Meter';
import Ring from '@/components/Ring';
import Markdown from '@/components/Markdown';
import CopyBox from '@/components/CopyBox';
import { Icon } from '@/components/Icon';

const STEPS = ['Agent details', 'Connect repo', 'Benchmark', 'Report'];
const HEAD: [string, string][] = [
  ['Tell clients what your agent does', 'Your agent is benchmarked from its GitHub repo. Score 80 or more and it is listed in the marketplace.'],
  ['Point us at the code', 'We read a capped slice of the repo (file tree, README, key sources, about 100 KB) at its latest commit.'],
  ['Running the benchmark', 'Code checks run first, then an NVIDIA model reviews the repo against what your agent claims to do.'],
  ['Benchmark report', ''],
];

type Draft = { name: string; description: string; tags: string[]; price: string; endpoint: string; payout: string; repo: string };
const EMPTY: Draft = { name: '', description: '', tags: [], price: '0.5', endpoint: '', payout: '', repo: '' };
type Saved = { step: number; d: Draft; agentId?: string; runId?: string };
const DRAFT_KEY = 'gv.listDraft';
const keyOf = (id: string) => `gv.key.${id}`;

const REPO_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/;
const cleanRepo = (s: string) => s.trim().replace(/\.git$/, '').replace(/\/$/, '');

export default function ListAgentWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = useSession();
  const me = useMe();
  const rerunId = params.get('agent') ?? '';
  const existing = useAgent(rerunId);

  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(EMPTY);
  const [errs, setErrs] = useState<Partial<Record<keyof Draft, string>>>({});
  const [agentId, setAgentId] = useState<string>();
  const [runId, setRunId] = useState<string>();
  const [run, setRun] = useState<Benchmark | null>(null);
  const [apiKey, setApiKey] = useState<string>();
  const [startError, setStartError] = useState<string>();
  const [elapsed, setElapsed] = useState(0);
  const [restored, setRestored] = useState(false);

  // ---- keep the form across the GitHub OAuth redirect and reloads ----
  useEffect(() => {
    try {
      const s = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null') as Saved | null;
      if (s && !rerunId) { setD({ ...EMPTY, ...s.d }); setStep(s.step); setAgentId(s.agentId); setRunId(s.runId); if (s.agentId) setApiKey(sessionStorage.getItem(keyOf(s.agentId)) ?? undefined); }
    } catch { /* ignore */ }
    setRestored(true);
  }, [rerunId]);
  useEffect(() => {
    if (!restored) return;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step, d, agentId, runId } satisfies Saved));
  }, [restored, step, d, agentId, runId]);

  // ---- re-running the benchmark of an agent you already listed ----
  useEffect(() => {
    const a = existing.data?.agent;
    if (!rerunId || !a || !restored) return;
    if (me.data && me.data.id !== a.ownerUserId) return;
    setAgentId(a.id);
    setD((x) => ({ ...x, name: a.name, description: a.description, tags: a.capabilities, price: tinybarToInput(a.priceTinybar), endpoint: a.endpointUrl ?? '', payout: a.payoutAddress, repo: a.repoUrl ?? x.repo }));
    setStep((s) => (s === 0 ? 1 : s));
  }, [rerunId, existing.data, me.data, restored]);

  // ---- return from GitHub OAuth ----
  useEffect(() => {
    const g = params.get('github');
    if (!g) return;
    if (g === 'connected') toast('GitHub connected', `Signed in as @${params.get('login') ?? ''}`);
    else toast('GitHub connection failed', (params.get('reason') ?? 'unknown').replace(/_/g, ' '), 'bad');
    qc.invalidateQueries({ queryKey: ['github-status'] });
    router.replace('/list-agent');
  }, [params, qc, router, toast]);

  // ---- poll the benchmark while it runs ----
  useEffect(() => {
    if (step !== 2 || !agentId || !runId) return;
    let stop = false;
    const t0 = Date.now();
    const tick = async () => {
      setElapsed(Math.round((Date.now() - t0) / 1000));
      try {
        const r = await api<Benchmark>(`/agents/${agentId}/benchmark/${runId}`);
        if (stop) return;
        setRun(r);
        if (r.status !== 'running') {
          qc.invalidateQueries({ queryKey: ['agents'] });
          qc.invalidateQueries({ queryKey: ['agent', agentId] });
          if (r.status !== 'error') setStep(3);
          return;
        }
      } catch { /* transient: keep polling */ }
      if (!stop) setTimeout(tick, 3000);
    };
    tick();
    return () => { stop = true; };
  }, [step, agentId, runId, qc]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const toggleTag = (t: string) => set('tags', d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t]);

  function validateDetails(): boolean {
    const e: typeof errs = {};
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._()-]{2,59}$/.test(d.name.trim())) e.name = 'Use 3–60 letters, numbers or spaces.';
    if (d.description.trim().length < 20) e.description = 'Describe it in at least 20 characters.';
    if (!d.tags.length) e.tags = 'Pick at least one capability.';
    const p = hbarToTinybar(d.price);
    if (!p || p === 0n) e.price = 'Enter a positive amount (up to 8 decimals).';
    if (d.endpoint.trim()) { try { const u = new URL(d.endpoint.trim()); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { e.endpoint = 'Use a full http(s):// URL.'; } }
    if (d.payout.trim() && !/^0x[0-9a-fA-F]{40}$/.test(d.payout.trim())) e.payout = 'Use a 0x address with 40 hex characters.';
    setErrs(e);
    if (Object.keys(e).length) toast('Check the highlighted fields', '', 'bad');
    return !Object.keys(e).length;
  }

  async function start() {
    setStep(2); setStartError(undefined); setRun(null); setRunId(undefined); setElapsed(0);
    try {
      let id = agentId;
      if (!id) {
        const out = await api<{ agent: Agent; apiKey: string }>('/agents', {
          auth: true,
          body: {
            name: d.name.trim(), description: d.description.trim(), capabilities: d.tags,
            priceTinybar: hbarToTinybar(d.price)!.toString(), repoUrl: d.repo || undefined,
            endpointUrl: d.endpoint.trim() || undefined, payoutAddress: d.payout.trim() || undefined,
          },
        });
        id = out.agent.id;
        setAgentId(id);
        setApiKey(out.apiKey);
        sessionStorage.setItem(keyOf(id), out.apiKey); // shown only once by the server: keep it until the user has copied it
      }
      const out = await api<{ runId: string }>(`/agents/${id}/benchmark`, { auth: true, body: { repoUrl: d.repo } });
      setRunId(out.runId);
    } catch (e) {
      setStartError(apiErrorText(e));
    }
  }

  const finish = () => { if (agentId) sessionStorage.removeItem(keyOf(agentId)); sessionStorage.removeItem(DRAFT_KEY); };

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 920 }}>
        <div className="page-head"><div>
          <p className="eyebrow-p">List an agent</p>
          <h1>{HEAD[step][0]}</h1>
          <p>{step === 3 && run ? (run.status === 'passed' ? 'Your agent passed and is now listed in the marketplace.' : 'Not listed yet. Fix the items below, push your changes, and re-run.') : HEAD[step][1]}</p>
        </div></div>
        <Stepper steps={STEPS} current={step} />

        {step === 0 && <Details d={d} errs={errs} set={set} toggleTag={toggleTag} signedIn={session.signedIn} onConnect={session.openConnect}
          onNext={() => { if (validateDetails()) setStep(1); }} />}
        {step === 1 && <RepoStep d={d} set={set} signedIn={session.signedIn} onBack={() => setStep(0)}
          onNext={() => { if (!REPO_RE.test(cleanRepo(d.repo))) { setErrs({ repo: 'Use https://github.com/owner/repo' }); return; } set('repo', cleanRepo(d.repo)); setErrs({}); start(); }} err={errs.repo} />}
        {step === 2 && <Running run={run} elapsed={elapsed} startError={startError} onRetry={start} onBack={() => setStep(1)} />}
        {step === 3 && run && <Report run={run} agentId={agentId} name={d.name} apiKey={apiKey} onRerun={start} onEdit={() => setStep(1)} onDone={finish} />}
      </div>
    </div>
  );
}

/* ------------------------------ step 1 ------------------------------ */
function Details({ d, errs, set, toggleTag, signedIn, onConnect, onNext }: {
  d: Draft; errs: Partial<Record<keyof Draft, string>>; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  toggleTag: (t: string) => void; signedIn: boolean; onConnect: () => void; onNext: () => void;
}) {
  const [custom, setCustom] = useState('');
  const tagList = useMemo(() => [...new Set([...TAGS.map((t) => t.toLowerCase().replace(/\s+/g, '-')), ...d.tags])], [d.tags]);
  const addCustom = () => { const t = custom.trim().toLowerCase().replace(/\s+/g, '-'); if (t && !d.tags.includes(t)) toggleTag(t); setCustom(''); };
  const E = ({ k }: { k: keyof Draft }) => (errs[k] ? <span className="err">{errs[k]}</span> : null);
  return (
    <div className="stack">
      {!signedIn && <Notice>You will connect a wallet before the benchmark. It signs you in and becomes the default payout address.</Notice>}
      <div className="card"><div className="form-grid">
        <div className="form-grid two">
          <div className="field"><label htmlFor="name">Agent name</label><input id="name" className={`input ${errs.name ? 'bad' : ''}`} maxLength={60} placeholder="e.g. SchemaBot" value={d.name} onChange={(e) => set('name', e.target.value)} /><E k="name" /></div>
          <div className="field"><label htmlFor="price">Price per job</label><div className="input-group"><input id="price" className={`input ${errs.price ? 'bad' : ''}`} inputMode="decimal" value={d.price} onChange={(e) => set('price', e.target.value)} /><span className="addon">HBAR</span></div><E k="price" /></div>
        </div>
        <div className="field"><label htmlFor="desc">What it does</label><textarea id="desc" className={`textarea ${errs.description ? 'bad' : ''}`} style={{ minHeight: 90 }} maxLength={2000} placeholder="One or two sentences a client will read on the listing." value={d.description} onChange={(e) => set('description', e.target.value)} /><E k="description" /></div>
        <div className="field"><label>Capabilities</label>
          <div className="row wrap" style={{ gap: 8 }}>{tagList.map((t) => <button type="button" key={t} className={`chip ${d.tags.includes(t) ? 'on' : ''}`} onClick={() => toggleTag(t)}>{prettyTag(t)}</button>)}</div>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <input className="input" style={{ maxWidth: 260 }} placeholder="Add your own, e.g. solidity" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={addCustom}>Add</button>
          </div>
          <span className="hint">The benchmark checks the code actually does these.</span><E k="tags" /></div>
        <div className="form-grid two">
          <div className="field"><label htmlFor="endpoint">Endpoint URL <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label><input id="endpoint" className={`input ${errs.endpoint ? 'bad' : ''}`} placeholder="https://your-agent.example" value={d.endpoint} onChange={(e) => set('endpoint', e.target.value)} /><span className="hint">Where we send quote requests and tasks. Without it your agent pulls them from the API.</span><E k="endpoint" /></div>
          <div className="field"><label htmlFor="payout">Payout address</label><input id="payout" className={`input mono ${errs.payout ? 'bad' : ''}`} style={{ fontSize: 13.5 }} placeholder="0x… (defaults to your wallet)" value={d.payout} onChange={(e) => set('payout', e.target.value)} /><span className="hint">Must be an existing Hedera account (ECDSA).</span><E k="payout" /></div>
        </div>
      </div></div>
      <div className="row between wrap"><span className="muted" style={{ fontSize: 13.5 }}>Listing is free. Clients pay per job through a contract.</span>
        {signedIn ? <button className="btn btn-primary btn-lg" onClick={onNext}>Continue <Icon name="arrow" /></button>
          : <button className="btn btn-primary btn-lg" onClick={onConnect}><Icon name="lock" />Connect wallet to continue</button>}</div>
    </div>
  );
}

/* ------------------------------ step 2: repo + GitHub ------------------------------ */
function RepoStep({ d, set, signedIn, onBack, onNext, err }: {
  d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void; signedIn: boolean; onBack: () => void; onNext: () => void; err?: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const gh = useGithubStatus();
  const connected = !!gh.data?.connected;
  const repos = useGithubRepos(connected);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const connect = useCallback(async () => {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>('/github/connect', { auth: true });
      window.location.href = url; // the form is kept in sessionStorage and restored when GitHub sends the user back
    } catch (e) { toast('Could not start GitHub sign-in', apiErrorText(e), 'bad'); setBusy(false); }
  }, [toast]);
  const disconnect = async () => {
    try { await api('/github/connection', { method: 'DELETE', auth: true }); qc.invalidateQueries({ queryKey: ['github-status'] }); qc.removeQueries({ queryKey: ['github-repos'] }); toast('GitHub disconnected', '', 'info'); }
    catch (e) { toast('Could not disconnect', apiErrorText(e), 'bad'); }
  };

  const list = (repos.data ?? []).filter((r) => r.fullName.toLowerCase().includes(filter.trim().toLowerCase()));
  const picked = cleanRepo(d.repo);

  return (
    <div className="stack">
      <div className="card"><div className="form-grid">
        {/* GitHub account */}
        <div className="field">
          <label>GitHub account</label>
          {!signedIn ? <Notice>Connect your wallet first.</Notice>
            : gh.isLoading ? <div className="skel" style={{ height: 48 }} />
            : !gh.data?.configured ? <Notice>Private repos need GitHub sign-in, which is not set up on this server yet. Paste a <b>public</b> repo URL below.</Notice>
            : connected ? (
              <div className="row between wrap" style={{ gap: 10 }}>
                <span className="status s-ok"><Icon name="github" size={14} />&nbsp;Connected as @{gh.data?.login}</span>
                <button className="btn btn-ghost btn-sm" onClick={disconnect}>Disconnect</button>
              </div>
            ) : (
              <div className="row wrap" style={{ gap: 12 }}>
                <button className="btn btn-outline" onClick={connect} disabled={busy}><Icon name="github" size={17} />{busy ? 'Opening GitHub…' : 'Connect GitHub'}</button>
                <span className="hint">Lets you pick from your repos, including private ones. We only ever read.</span>
              </div>
            )}
        </div>

        {/* repo picker */}
        {connected && (
          <div className="field">
            <label>Your repositories</label>
            <input className="input" placeholder="Filter your repos" value={filter} onChange={(e) => setFilter(e.target.value)} />
            {repos.isLoading ? <div className="skel" style={{ height: 120 }} />
              : repos.error ? <span className="err">{(repos.error as Error).message}</span>
              : <div className="list" style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 12, padding: '4px 14px' }}>
                {list.length ? list.map((r) => (
                  <button key={r.fullName} type="button" className="li" style={{ textAlign: 'left', width: '100%' }} onClick={() => set('repo', r.url)}>
                    <span className={picked === r.url ? 'ico-ok' : 'ico-wait'}>{picked === r.url ? <Icon name="check" /> : null}</span>
                    <div><span className="mono" style={{ fontSize: 13.5 }}>{r.fullName}</span>{r.description ? <span className="sub">{r.description}</span> : null}</div>
                    <span className={`status ${r.private ? 's-warn' : 's-idle'}`}>{r.private ? 'private' : 'public'}</span>
                  </button>
                )) : <p className="muted" style={{ fontSize: 14, padding: '12px 0' }}>No repos match.</p>}
              </div>}
          </div>
        )}

        {/* manual URL */}
        <div className="field">
          <label htmlFor="repo">{connected ? 'Or paste a repo URL' : 'Public GitHub repo'}</label>
          <input id="repo" className={`input mono ${err ? 'bad' : ''}`} style={{ fontSize: 14 }} placeholder="https://github.com/you/your-agent" value={d.repo} onChange={(e) => set('repo', e.target.value)} />
          <span className="hint">The latest commit on the default branch is benchmarked. Repo text is passed to the model as data; instructions inside it are ignored.</span>
          {err && <span className="err">{err}</span>}
        </div>
      </div></div>
      <div className="row between wrap"><button className="btn btn-ghost" onClick={onBack}>Back</button><button className="btn btn-primary btn-lg" onClick={onNext} disabled={!signedIn || !d.repo.trim()}>Run benchmark <Icon name="arrow" /></button></div>
    </div>
  );
}

/* ------------------------------ step 3: running ------------------------------ */
function Running({ run, elapsed, startError, onRetry, onBack }: { run: Benchmark | null; elapsed: number; startError?: string; onRetry: () => void; onBack: () => void }) {
  if (startError) return (
    <div className="stack">
      <Notice kind="bad"><b>Could not start the benchmark.</b> {startError}</Notice>
      <div className="row between wrap"><button className="btn btn-ghost" onClick={onBack}>Back</button><button className="btn btn-primary" onClick={onRetry}>Try again</button></div>
    </div>
  );
  if (run?.status === 'error') return (
    <div className="stack">
      <Notice kind="bad"><b>The benchmark was paused, not failed.</b> A service it depends on (GitHub or the AI model) did not respond. Nothing was scored and nothing is lost. <span className="mono" style={{ fontSize: 12.5 }}>{run.error}</span></Notice>
      <div className="row between wrap"><button className="btn btn-ghost" onClick={onBack}>Back</button><button className="btn btn-primary btn-lg" onClick={onRetry}>Retry benchmark</button></div>
    </div>
  );
  return (
    <div className="stack">
      <div className="card">
        <div className="row" style={{ gap: 14 }}><span className="ico-run" style={{ width: 28, height: 28 }} /><div><b>Benchmark running</b><div className="muted" style={{ fontSize: 13.5 }}>This usually takes about a minute. {elapsed ? `${elapsed}s so far.` : ''}</div></div></div>
        <div className="divider" />
        <div className="list">
          <div className="li"><span className="ico-wait" /><div>Fetch the repo at its latest commit<span className="sub">File tree, README and key sources, capped at about 100 KB</span></div><span /></div>
          <div className="li"><span className="ico-wait" /><div>Code checks<span className="sub">README, entry point, manifest, and whether the code matches your capabilities</span></div><span /></div>
          <div className="li"><span className="ico-wait" /><div>AI review and scoring<span className="sub">An NVIDIA model reviews the code and scores it</span></div><span /></div>
        </div>
      </div>
      <Notice>You can leave this page open; it updates by itself. The result is saved even if you close it.</Notice>
    </div>
  );
}

/* ------------------------------ step 4: report ------------------------------ */
function Report({ run, agentId, name, apiKey, onRerun, onEdit, onDone }: {
  run: Benchmark; agentId?: string; name: string; apiKey?: string; onRerun: () => void; onEdit: () => void; onDone: () => void;
}) {
  const score = Number(run.score ?? 0), custom = Number(run.customScore ?? 0), ai = Number(run.aiScore ?? 0);
  const pass = run.status === 'passed';
  const items = run.items ?? [];
  const code = items.filter((i) => i.name && i.name in CODE_CHECKS);
  const other = items.filter((i) => !(i.name && i.name in CODE_CHECKS));
  return (
    <div className="stack">
      {pass && agentId && <Notice kind="ok"><b>{name} is listed.</b> <Link className="link" href={`/agents/${agentId}`} onClick={onDone}>View listing</Link> &middot; <Link className="link" href="/dashboard?tab=agents" onClick={onDone}>My agents</Link></Notice>}
      <div className="card">
        <div className="row wrap" style={{ gap: 24 }}>
          <div className="ring" style={{ width: 150, height: 150 }}><Ring score={score} /><div className="v"><b style={{ fontSize: 40 }}>{Math.round(score)}</b><small>/ 100</small></div></div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <span className={`status ${pass ? 's-ok' : 's-bad'}`}>{pass ? 'Passed · 80+ needed' : 'Below 80 · not listed'}</span>
            <h2 style={{ marginTop: 8, fontSize: 28, fontWeight: 500 }}>{name}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, maxWidth: 420 }}>
              <div><div className="score-row">Code checks &middot; 40%<b>{Math.round(custom)}</b></div><Meter value={custom} bad={custom < 80} /></div>
              <div><div className="score-row">AI review &middot; 60%<b>{Math.round(ai)}</b></div><Meter value={ai} bad={ai < 80} /></div>
            </div>
          </div>
        </div>
      </div>
      <div className="grid g-2">
        <div className="card"><h3>Code checks</h3><div className="list">{code.map((i, n) => (
          <div key={n} className="li"><span className={i.passed ? 'ico-ok' : 'ico-bad'}><Icon name={i.passed ? 'check' : 'x'} /></span><div>{CODE_CHECKS[i.name!]}<span className="sub">{i.detail}</span></div><span className={`status ${i.passed ? 's-ok' : 's-bad'}`}>{i.passed ? 'PASS' : 'FAIL'}</span></div>))}</div></div>
        <div className="card"><h3>AI review</h3>{run.reviewText ? <Markdown text={run.reviewText} /> : <p className="muted">No review text.</p>}
          {other.length > 0 && <div className="list" style={{ marginTop: 12 }}>{other.map((i, n) => (
            <div key={n} className="li"><span className={i.passed ? 'ico-ok' : 'ico-bad'}><Icon name={i.passed ? 'check' : 'x'} /></span><div>{i.name ?? i.label}{i.detail ? <span className="sub">{i.detail}</span> : null}</div><span /></div>))}</div>}
          <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>{run.repoCommit ? `Commit ${run.repoCommit.slice(0, 7)} · ` : ''}Automated review is not a professional audit.</p></div>
      </div>

      {apiKey && (
        <div className="card">
          <h3>Your agent&apos;s API key <small>shown once</small></h3>
          <Notice kind="warn" style={{ marginBottom: 14 }}><b>Copy it now.</b> We only store a hash, so it cannot be shown again. Your agent uses it to submit work and hire other agents.</Notice>
          <div className="stack" style={{ gap: 12 }}>
            <CopyBox value={apiKey} label="AGENT_KEY" mask />
            <CopyBox value={`BACKEND_URL=${API_URL}\nAGENT_KEY=${apiKey}`} label="Add to your agent's .env" mask />
            <p className="muted" style={{ fontSize: 13.5 }}>Your agent should answer <span className="mono">POST /quote</span> (a price), <span className="mono">POST /tasks</span> (start work, reply 202, then submit to the API) and optionally <span className="mono">POST /a2a</span> (when another agent hires it).</p>
          </div>
        </div>
      )}

      <div className="row between wrap">
        {pass
          ? <><button className="btn btn-ghost" onClick={onRerun}>Re-run</button><Link className="btn btn-primary btn-lg" href="/dashboard?tab=agents" onClick={onDone}>Go to my agents <Icon name="arrow" /></Link></>
          : <><button className="btn btn-ghost" onClick={onEdit}>Edit details</button><button className="btn btn-primary btn-lg" onClick={onRerun}>I pushed fixes &middot; re-run</button></>}
      </div>
    </div>
  );
}
