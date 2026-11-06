'use client';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAgent, useMe } from '@/lib/queries';
import { CODE_CHECKS, jobsDone, passRate, prettyTag } from '@/lib/agents';
import { fmtHbar } from '@/lib/money';
import { shortAddr, dateShort } from '@/lib/format';
import Avatar from '@/components/Avatar';
import Meter from '@/components/Meter';
import Ring from '@/components/Ring';
import Markdown from '@/components/Markdown';
import StatusChip from '@/components/StatusChip';
import Notice, { Empty } from '@/components/Notice';
import { Icon } from '@/components/Icon';
import type { CheckItem } from '@/lib/types';

const Row = ({ i }: { i: CheckItem }) => (
  <div className="li">
    <span className={i.passed ? 'ico-ok' : 'ico-bad'}><Icon name={i.passed ? 'check' : 'x'} /></span>
    <div>{(i.name && CODE_CHECKS[i.name]) ?? i.name ?? i.label ?? 'Check'}{i.detail ? <span className="sub">{i.detail}</span> : null}</div>
    <span className={`status ${i.passed ? 's-ok' : 's-bad'}`}>{i.passed ? 'PASS' : 'FAIL'}</span>
  </div>
);

export default function AgentPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useAgent(id);
  const me = useMe();

  if (isLoading) return <div className="page"><div className="container"><div className="skel" style={{ height: 120, marginBottom: 20 }} /><div className="skel" style={{ height: 380 }} /></div></div>;
  if (error || !data) return <div className="page"><div className="container"><Empty title="Agent not found">It may have been removed.<br /><Link className="btn btn-outline btn-sm" href="/marketplace">Back to marketplace</Link></Empty></div></div>;

  const { agent: a, benchmark: b, recentJobs } = data;
  const mine = !!me.data && me.data.id === a.ownerUserId;
  const items = b?.items ?? [];
  const codeItems = items.filter((i) => i.name && i.name in CODE_CHECKS);
  const aiItems = items.filter((i) => !(i.name && i.name in CODE_CHECKS));
  const pr = passRate(a);
  const n = jobsDone(a);
  const score = a.score;

  return (
    <div className="page">
      <div className="container">
        <nav className="crumbs"><Link href="/marketplace">Marketplace</Link><span>/</span><span>{a.name}</span></nav>
        <div className="row wrap" style={{ gap: 22, marginBottom: 28 }}>
          <Avatar name={a.name} large />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="row wrap" style={{ gap: 8, marginBottom: 6 }}>
              {a.status === 'listed' ? <span className="status s-ok">Listed</span> : <span className="status s-bad">Not listed</span>}
              {mine && <span className="tag">your agent</span>}
              {a.isSeeded && <span className="tag">sample data</span>}
              {a.capabilities.map((t) => <span key={t} className="tag">{prettyTag(t)}</span>)}
            </div>
            <h1 style={{ fontSize: 'clamp(28px,4vw,40px)', fontWeight: 500, lineHeight: 1.1 }}>{a.name}</h1>
            <p className="muted" style={{ marginTop: 6, maxWidth: 620 }}>{a.description}</p>
          </div>
        </div>

        <div className="grid g-side">
          <div className="stack">
            {b && score != null ? (
              <div className="card">
                <h3>Benchmark result {b.repoCommit ? <small>commit <span className="mono">{b.repoCommit.slice(0, 7)}</span></small> : null}</h3>
                <div className="row wrap" style={{ gap: 22 }}>
                  <div className="ring"><Ring score={score} /><div className="v"><b>{Math.round(score)}</b><small>/ 100</small></div></div>
                  <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div><div className="score-row">Code checks · 40%<b>{Math.round(a.customScore ?? 0)}</b></div><Meter value={a.customScore ?? 0} /></div>
                    <div><div className="score-row">AI review · 60%<b>{Math.round(a.aiScore ?? 0)}</b></div><Meter value={a.aiScore ?? 0} /></div>
                    <div className="muted" style={{ fontSize: 13 }}>Pass mark is 80. Score = 0.4 × code checks + 0.6 × AI review.</div>
                  </div>
                </div>
              </div>
            ) : (
              <Notice>This agent has no benchmark report. It is a sample listing.</Notice>
            )}

            {codeItems.length > 0 && <div className="card"><h3>Code checks</h3><div className="list">{codeItems.map((i, n) => <Row key={`${i.name}-${n}`} i={i} />)}</div></div>}

            {b && (b.reviewText || aiItems.length > 0) && (
              <div className="card">
                <h3>AI code review <small>NVIDIA model</small></h3>
                {b.reviewText && <Markdown text={b.reviewText} />}
                {aiItems.length > 0 && <div className="list" style={{ marginTop: 14 }}>{aiItems.map((i, n) => <Row key={`${i.name ?? i.label}-${n}`} i={i} />)}</div>}
                <Notice style={{ marginTop: 16 }}>Automated review is not a professional audit.</Notice>
              </div>
            )}

            <div className="card">
              <h3>Recent jobs on Gigiverse</h3>
              {recentJobs.length ? (
                <div className="list">{recentJobs.map((j) => (
                  <Link key={j.id} className="li" href={`/jobs/${j.id}`}>
                    <span className="mono muted">{j.id.slice(0, 6)}</span>
                    <div>{j.title}<span className="sub">{fmtHbar(j.priceTinybar)} · {dateShort(j.createdAt)}</span></div>
                    <StatusChip status={j.status} />
                  </Link>))}</div>
              ) : <p className="muted" style={{ fontSize: 14 }}>No jobs yet.</p>}
            </div>
          </div>

          <aside className="stack">
            <div className="card" style={{ position: 'sticky', top: 88 }}>
              <div className="muted" style={{ fontSize: 13 }}>Fixed price per job</div>
              <div className="price" style={{ margin: '4px 0 16px', fontSize: 32 }}>{fmtHbar(a.priceTinybar)}</div>
              <dl className="kv" style={{ marginBottom: 18 }}>
                <dt>Jobs done</dt><dd>{n}</dd>
                <dt>Pass rate</dt><dd>{pr !== null ? `${pr}%` : '—'}</dd>
                <dt>Earned here</dt><dd>{fmtHbar(a.earnedTinybar ?? '0')}</dd>
                <dt>Payout wallet</dt><dd className="mono" style={{ fontSize: 12.5 }}>{shortAddr(a.payoutAddress)}</dd>
                {a.repoUrl && <><dt>Repo</dt><dd><a className="link" href={a.repoUrl} target="_blank" rel="noopener noreferrer">{a.repoUrl.replace('https://github.com/', '')}<Icon name="ext" size={13} /></a></dd></>}
              </dl>
              {a.status === 'listed'
                ? <Link className="btn btn-primary btn-block btn-lg" href={`/post-job?agent=${a.id}`}>Hire {a.name}</Link>
                : mine ? <Link className="btn btn-outline btn-block" href={`/list-agent?agent=${a.id}`}>Re-run benchmark</Link> : <button className="btn btn-ghost btn-block" disabled>Not available</button>}
              <p className="muted" style={{ fontSize: 12.5, marginTop: 12, textAlign: 'center' }}>Your HBAR is locked in a contract made for this job and released only on PASS.</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
