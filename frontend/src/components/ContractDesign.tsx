'use client';
import { useState } from 'react';
import { CHECKS, type ContractSpec, type DesignSub, type TermsProof } from '@/lib/types';
import { fmtHbar } from '@/lib/money';
import { shortAddr } from '@/lib/format';
import { contractUrl, shortTx, txUrl } from '@/lib/hashscan';
import { Icon } from './Icon';
import Notice from './Notice';
import Ring from './Ring';

// How the contract was decided: inputs -> analysis -> trust -> terms -> proof on the contract.
// Every number comes from the stored design or from the contract itself; nothing is invented here.

const KNOWN = [/^Estimated effort/, /^Trust \d/, /^High-risk/, /must pay its sub-agents/, /pass threshold/, /^Security review added/, /^Provider history/];
const pick = (lines: string[], re: RegExp) => lines.filter((l) => re.test(l));
const checkLabel = (k: string) => CHECKS.find((c) => c.key === k)?.label ?? k;
const words = (caps: string[]) => [...new Set(caps.flatMap((c) => c.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 3))];

/** The requirement text with the words that match the agent's capabilities marked. */
function Highlighted({ text, caps }: { text: string; caps: string[] }) {
  const ws = words(caps);
  const shown = text.length > 360 ? `${text.slice(0, 360)}…` : text;
  return <>{shown.split(/(\W+)/).map((t, i) => (ws.some((w) => t.toLowerCase() === w || (t.length > 3 && t.toLowerCase().includes(w))) ? <mark key={i} className="cd-hit">{t}</mark> : <span key={i}>{t}</span>))}</>;
}

function Dots({ n, of = 5 }: { n: number; of?: number }) {
  return <span className="cd-dots" aria-label={`${n} out of ${of}`}>{Array.from({ length: of }, (_, i) => <i key={i} className={i < n ? 'on' : ''} />)}</span>;
}

function Stage({ n, title, tag, wide, children }: { n: number; title: string; tag?: React.ReactNode; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={`cd-stage ${wide ? 'wide' : ''}`}>
      <header><span className="cd-n">{n}</span><h4>{title}</h4>{tag}</header>
      <div className="cd-body">{children}</div>
    </section>
  );
}

function Term({ label, value, why }: { label: string; value: React.ReactNode; why?: string[] }) {
  return (
    <div className="cd-term">
      <span className="cd-k">{label}</span>
      <b>{value}</b>
      {why?.length ? <p>{why.join(' ')}</p> : null}
    </div>
  );
}

function ProofTable({ proof }: { proof: TermsProof }) {
  if (proof.state === 'not_deployed') return <p className="muted" style={{ fontSize: 14 }}>The contract is not deployed yet. These terms are checked against it as soon as it is.</p>;
  if (proof.state === 'no_design') return <Notice kind="warn">This contract was deployed without a stored design, so there is nothing to compare.</Notice>;
  if (proof.state === 'unavailable') return <Notice kind="warn">Could not read the contract just now{proof.error ? ` (${proof.error.slice(0, 90)})` : ''}. Nothing is shown as verified until it can be read. It retries by itself.</Notice>;
  const ok = proof.rows.every((r) => r.match);
  return (
    <>
      <div className="cd-proof-head"><span className={`status ${ok ? 's-ok' : 's-bad'}`}>{ok ? 'Contract matches the design' : 'Mismatch with the design'}</span><span className="muted" style={{ fontSize: 13 }}>read from the deployed contract</span></div>
      <div className="cd-rows">
        {proof.rows.map((r) => (
          <div key={r.key} className="cd-row">
            <span className={r.match ? 'ico-ok' : 'ico-bad'}><Icon name={r.match ? 'check' : 'x'} /></span>
            <div><b>{r.label}</b><span className="sub">Designed <span className="mono">{r.designed}</span></span><span className="sub">On-chain <span className="mono">{r.onchain}</span></span></div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function ContractDesign({ mode = 'full', requirements, agent, spec, source, specHash, requestedChecks = [], proof, contract, deployTx }: {
  mode?: 'preview' | 'full';
  requirements?: string;
  agent: { name: string; capabilities: string[] };
  spec: ContractSpec;
  source: string;
  specHash?: string;
  requestedChecks?: string[];
  proof?: TermsProof;
  contract?: string | null;
  deployTx?: string | null;
}) {
  const [open, setOpen] = useState(mode === 'full');
  const r = spec.rationale ?? [];
  const history = pick(r, /^Provider history/).map((l) => l.replace(/^Provider history: /, ''));
  const summary = r.filter((l) => !KNOWN.some((re) => re.test(l))).pop();
  const added = spec.checks.filter((c) => !requestedChecks.includes(c));
  const ai = source === 'ai';
  const caps = agent.capabilities;

  return (
    <div className={`cd ${mode}`}>
      <div className="cd-top">
        <div>
          <b>{mode === 'preview' ? 'How the contract would be designed' : 'How this contract was designed'}</b>
          <span className="muted" style={{ fontSize: 13.5, display: 'block' }}>The designer reads the job and the agent, then sets the terms the contract enforces.</span>
        </div>
        <span className={`status ${ai ? 's-ok' : 's-warn'}`}>{ai ? 'Analysed by AI' : 'Default rules (AI unavailable)'}</span>
      </div>
      {!ai && <Notice kind="warn" style={{ marginBottom: 14 }}>The AI analysis was unavailable, so the designer used safe default estimates. The terms below are still bounded and enforced.</Notice>}

      {mode === 'preview' && !open && (
        <div className="cd-glance">
          <span><span className="cd-k">Deadline</span> <b>{spec.deadlineHours}h</b></span>
          <span><span className="cd-k">Pass mark</span> <b>{spec.passThresholdPct}%</b></span>
          <span><span className="cd-k">Sub-agents</span> <b>{spec.maxSubLegs} &middot; {(spec.maxSubBps / 100).toFixed(0)}% cap</b></span>
          <span><span className="cd-k">Risk</span> <b>{spec.risk}</b></span>
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Show the reasoning</button>
        </div>
      )}

      {open && (
        <div className="cd-flow">
          {requirements !== undefined && (
            <Stage n={1} title="Inputs" wide>
              <div className="cd-inputs">
                <div><span className="cd-k">The client asked for</span><p className="cd-req"><Highlighted text={requirements} caps={caps} /></p></div>
                <div><span className="cd-k">{agent.name} offers</span>
                  <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>{caps.map((c) => <span key={c} className="tag">{c}</span>)}</div>
                  <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Highlighted words in the request match these capabilities.</p></div>
              </div>
            </Stage>
          )}

          <Stage n={requirements !== undefined ? 2 : 1} title="Analysis" tag={<span className="tag">{ai ? 'AI' : 'fallback'}</span>}>
            <div className="cd-stats">
              <div><span className="cd-k">Complexity</span><Dots n={spec.complexity} /><b>{spec.complexity} / 5</b></div>
              <div><span className="cd-k">Risk</span><span className={`status ${spec.risk === 'high' ? 's-bad' : spec.risk === 'medium' ? 's-warn' : 's-ok'}`}>{spec.risk}</span></div>
              <div><span className="cd-k">Estimated effort</span><b>{spec.effortHours} h</b></div>
            </div>
            {summary && <p className="cd-sum">{summary}</p>}
          </Stage>

          <Stage n={requirements !== undefined ? 3 : 2} title="Agent trust">
            <div className="cd-trust">
              <div className="ring" style={{ width: 92, height: 92 }}><Ring score={spec.trustScore} stroke={11} neutral /><div className="v"><b style={{ fontSize: 24 }}>{Math.round(spec.trustScore)}</b><small>/ 100</small></div></div>
              <div>
                <span className={`status ${spec.trustTier === 'trusted' ? 's-ok' : spec.trustTier === 'standard' ? 's-idle' : 's-warn'}`}>{spec.trustTier}</span>
                <ul className="cd-list">{(history.length ? history : ['No history recorded yet']).map((h, i) => <li key={i}>{h}</li>)}</ul>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Lower trust means a longer deadline and less room to hand work to other agents.</p>
          </Stage>

          <Stage n={requirements !== undefined ? 4 : 3} title="Decided terms">
            <div className="cd-terms">
              <Term label="Deadline" value={`${spec.deadlineHours} h`} why={pick(r, /^Estimated effort/)} />
              <Term label="Sub-agent spending cap" value={`${(spec.maxSubBps / 100).toFixed(0)}% of the price`} why={pick(r, /^Trust \d|^High-risk/)} />
              <Term label="Max sub-agents" value={spec.maxSubLegs} />
              <Term label="Payout grace" value={`${spec.payoutGraceSecs / 3600} h`} why={pick(r, /must pay its sub-agents/)} />
              <Term label="Pass mark" value={`${spec.passThresholdPct}%`} why={pick(r, /pass threshold/)} />
              <Term label="Checks" value={<span className="row wrap" style={{ gap: 6 }}>{spec.checks.length ? spec.checks.map((c) => <span key={c} className={`tag ${added.includes(c) ? 'cd-added' : ''}`}>{checkLabel(c)}{added.includes(c) ? ' · added' : ''}</span>) : 'Requirements only'}</span>} why={pick(r, /^Security review added/)} />
            </div>
            {spec.warnings?.length > 0 && <Notice kind="warn" style={{ marginTop: 12 }}>{spec.warnings.join(' ')}</Notice>}
          </Stage>

          {mode === 'full' && proof && (
            <Stage n={requirements !== undefined ? 5 : 4} title="Proof on the contract" tag={contract ? <a className="link mono" style={{ fontSize: 12.5 }} href={contractUrl(contract)} target="_blank" rel="noopener noreferrer">{shortAddr(contract)}<Icon name="ext" size={13} /></a> : undefined}>
              <ProofTable proof={proof} />
              <dl className="kv" style={{ marginTop: 12 }}>
                {specHash && <><dt>Design fingerprint</dt><dd className="mono" style={{ fontSize: 12 }}>{shortTx(specHash)}</dd></>}
                {deployTx && <><dt>Deployed in</dt><dd><a className="link mono" style={{ fontSize: 12 }} href={txUrl(deployTx)} target="_blank" rel="noopener noreferrer">{shortTx(deployTx)}<Icon name="ext" size={13} /></a></dd></>}
              </dl>
            </Stage>
          )}
        </div>
      )}
      {mode === 'preview' && open && <div style={{ marginTop: 10 }}><button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Hide the reasoning</button></div>}
    </div>
  );
}

/** One card per sub-agent hire: its own designed terms and proof that the contract holds the same terms hash. */
export function SubContracts({ subs }: { subs: DesignSub[] }) {
  if (!subs.length) return null;
  return (
    <div className="stack" style={{ gap: 14 }}>
      {subs.map((s) => {
        const p = s.proof;
        const sp = s.design.spec;
        return (
          <div key={s.legId} className="cd-sub">
            <div className="row between wrap" style={{ gap: 10 }}>
              <div><span className="cd-k">Sub-contract #{s.legId} &middot; hired by the agent inside this job</span><b style={{ display: 'block', fontSize: 16 }}>{s.callee?.name ?? 'Sub-agent'} &middot; {fmtHbar(s.priceTinybar)}</b></div>
              <span className={`status ${s.status === 'paid' ? 's-ok' : s.status === 'defaulted' ? 's-bad' : 's-idle'}`}>{s.status}</span>
            </div>
            {sp ? <ContractDesign mode="full" agent={{ name: s.callee?.name ?? 'Sub-agent', capabilities: s.callee?.capabilities ?? [] }} spec={sp} source={s.design.source} specHash={s.design.specHash} />
              : <Notice kind="warn" style={{ marginTop: 12 }}>The designer was unavailable when this agent was hired, so the leg carries a plain default terms hash, not designed terms.</Notice>}
            <div className="cd-rows" style={{ marginTop: 12 }}>
              {p.state === 'checked' ? (
                <>
                  <div className="cd-row"><span className={p.match ? 'ico-ok' : 'ico-bad'}><Icon name={p.match ? 'check' : 'x'} /></span>
                    <div><b>Terms hash on the contract</b><span className="sub">{p.match ? 'Equals the hash of the terms above' : 'Does NOT equal the stored terms'} &middot; <span className="mono">{shortTx(p.onchainHash)}</span></span></div></div>
                  <div className="cd-row"><span className={p.priceMatch ? 'ico-ok' : 'ico-bad'}><Icon name={p.priceMatch ? 'check' : 'x'} /></span>
                    <div><b>Price on the contract</b><span className="sub">{fmtHbar(p.onchainPrice)} on-chain &middot; {fmtHbar(s.priceTinybar)} recorded</span></div></div>
                </>
              ) : <Notice kind="warn">{p.state === 'missing' ? 'This leg was not found on the contract.' : 'Could not read the contract just now. It retries by itself.'}</Notice>}
              {s.addLegTx && <div className="muted" style={{ fontSize: 13 }}>Added in <a className="link mono" href={txUrl(s.addLegTx)} target="_blank" rel="noopener noreferrer">{shortTx(s.addLegTx)}<Icon name="ext" size={13} /></a></div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
