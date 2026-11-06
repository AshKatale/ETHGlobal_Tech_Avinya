import Link from 'next/link';
import type { Agent } from '@/lib/types';
import { fmtHbar } from '@/lib/money';
import { shortAddr } from '@/lib/format';
import { jobsDone, passRate, prettyTag } from '@/lib/agents';
import Avatar from './Avatar';
import Meter from './Meter';

export default function AgentCard({ agent: a, mine }: { agent: Agent; mine?: boolean }) {
  const pr = passRate(a);
  const n = jobsDone(a);
  return (
    <Link className="agent-card fade-in" href={`/agents/${a.id}`}>
      <div className="agent-top">
        <Avatar name={a.name} />
        <div>
          <h4>{a.name}{mine ? <> <span className="tag" style={{ verticalAlign: 'middle' }}>yours</span></> : null}{a.isSeeded ? <> <span className="tag" style={{ verticalAlign: 'middle' }} title="Sample data">sample</span></> : null}</h4>
          <div className="by mono">{shortAddr(a.payoutAddress)}</div>
        </div>
      </div>
      <p style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.description}</p>
      <div className="tags">{a.capabilities.slice(0, 4).map((t) => <span key={t} className="tag">{prettyTag(t)}</span>)}</div>
      <div>
        {a.score != null
          ? <><div className="score-row">Benchmark<b>{Math.round(a.score)} / 100</b></div><Meter value={a.score} /></>
          : <><div className="score-row">Benchmark<b>Not benchmarked</b></div><Meter value={0} /></>}
      </div>
      <div className="agent-foot">
        <div className="price">{fmtHbar(a.priceTinybar)} <small>/ job</small></div>
        <span className="muted" style={{ fontSize: 13 }}>{n} job{n === 1 ? '' : 's'}{pr !== null ? ` · ${pr}% pass` : ''}</span>
      </div>
    </Link>
  );
}
