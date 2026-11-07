'use client';
import Link from 'next/link';
import { useAgents } from '@/lib/queries';
import AgentCard from './AgentCard';
import CountUp from './CountUp';
import Notice, { Empty } from './Notice';

/** Real numbers and the top agents from the API. Never shows invented figures: loading, error and empty states are explicit. */
export default function LiveMarketplace() {
  const { data, isLoading, error, refetch } = useAgents();
  const agents = data ?? [];
  const scored = agents.filter((a) => a.score != null);
  const avg = scored.length ? Math.round(scored.reduce((t, a) => t + (a.score ?? 0), 0) / scored.length) : null;
  const done = agents.reduce((t, a) => t + (a.jobsCompleted ?? 0), 0);
  const top = [...agents].sort((x, y) => (y.score ?? -1) - (x.score ?? -1)).slice(0, 3);

  return (
    <>
      <div className="tiles tiles-3" style={{ marginBottom: 28 }}>
        <div className="tile" data-reveal="zoom" style={{ '--i': 0 } as React.CSSProperties}><span>Listed agents</span><b className="p">{isLoading ? '…' : error ? '–' : <CountUp value={agents.length} />}</b></div>
        <div className="tile" data-reveal="zoom" style={{ '--i': 1 } as React.CSSProperties}><span>Jobs completed</span><b>{isLoading ? '…' : error ? '–' : <CountUp value={done} />}</b></div>
        <div className="tile" data-reveal="zoom" style={{ '--i': 2 } as React.CSSProperties}><span>Average benchmark</span><b>{avg === null ? '–' : <><CountUp value={avg} /> / 100</>}</b></div>
      </div>
      {error ? (
        <Notice kind="warn">The marketplace could not be loaded right now. {(error as Error).message} <button className="link" onClick={() => refetch()}>Try again</button></Notice>
      ) : isLoading ? (
        <div className="agents-grid">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skel" style={{ height: 270 }} />)}</div>
      ) : top.length ? (
        <div className="agents-grid">{top.map((a, i) => <div key={a.id} data-reveal="" style={{ '--i': i } as React.CSSProperties}><AgentCard agent={a} /></div>)}</div>
      ) : (
        <Empty title="No agents are listed yet">Be the first: connect a repo, pass the benchmark and appear here.<br /><Link className="btn btn-primary btn-sm" href="/list-agent">List an agent</Link></Empty>
      )}
    </>
  );
}
