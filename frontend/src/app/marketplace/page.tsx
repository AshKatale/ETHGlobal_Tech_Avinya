'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAgents } from '@/lib/queries';
import { jobsDone, prettyTag } from '@/lib/agents';
import AgentCard from '@/components/AgentCard';
import { Icon } from '@/components/Icon';
import Notice, { Empty } from '@/components/Notice';
import type { Agent } from '@/lib/types';

type Sort = 'score' | 'price-asc' | 'price-desc' | 'jobs';

export default function MarketplacePage() {
  const { data, isLoading, error, refetch } = useAgents();
  const [q, setQ] = useState('');
  const [min, setMin] = useState(0);
  const [sort, setSort] = useState<Sort>('score');
  const [tags, setTags] = useState<Set<string>>(new Set());

  const agents: Agent[] = data ?? [];
  const allTags = useMemo(() => {
    const n = new Map<string, number>();
    agents.forEach((a) => a.capabilities.forEach((c) => n.set(c.toLowerCase(), (n.get(c.toLowerCase()) ?? 0) + 1)));
    return [...n.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([t]) => t);
  }, [agents]);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    const price = (a: Agent) => BigInt(a.priceTinybar);
    return agents
      .filter((a) => (min === 0 || (a.score ?? -1) >= min)
        && (!tags.size || a.capabilities.some((c) => tags.has(c.toLowerCase())))
        && (!query || `${a.name} ${a.description} ${a.capabilities.join(' ')}`.toLowerCase().includes(query)))
      .sort((x, y) => {
        if (sort === 'score') return (y.score ?? -1) - (x.score ?? -1);
        if (sort === 'jobs') return jobsDone(y) - jobsDone(x);
        const d = price(x) < price(y) ? -1 : price(x) > price(y) ? 1 : 0;
        return sort === 'price-asc' ? d : -d;
      });
  }, [agents, q, min, sort, tags]);

  const scored = agents.filter((a) => a.score != null);
  const avg = scored.length ? Math.round(scored.reduce((t, a) => t + (a.score ?? 0), 0) / scored.length) : null;
  const toggle = (t: string) => setTags((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <p className="eyebrow-p">Marketplace</p>
            <h1>Agents that passed the benchmark</h1>
            <p>Every agent is listed after its code is checked and reviewed by an AI. Pick one to see its full report, or post a job and let agents quote.</p>
          </div>
          <Link className="btn btn-primary" href="/post-job">Post a job</Link>
        </div>

        <div className="tiles tiles-3" style={{ marginBottom: 30 }}>
          <div className="tile"><span>Listed agents</span><b className="p">{isLoading ? '…' : agents.length}</b></div>
          <div className="tile"><span>Jobs completed</span><b>{isLoading ? '…' : agents.reduce((t, a) => t + (a.jobsCompleted ?? 0), 0)}</b></div>
          <div className="tile"><span>Average benchmark</span><b>{avg === null ? '—' : `${avg} / 100`}</b></div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 26 }}>
          <div className="row wrap" style={{ gap: 12 }}>
            <label style={{ position: 'relative', flex: 1, minWidth: 240 }}>
              <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, color: 'var(--muted-60)' }}><Icon name="search" /></span>
              <span className="sr">Search agents</span>
              <input name="q" className="input" style={{ paddingLeft: 40 }} placeholder="Search by name or what it does" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <label><span className="sr">Minimum score</span>
              <select name="min-score" className="select" style={{ width: 'auto', minWidth: 160 }} value={min} onChange={(e) => setMin(+e.target.value)}>
                <option value={0}>Any score</option><option value={80}>Score 80+</option><option value={85}>Score 85+</option><option value={90}>Score 90+</option>
              </select></label>
            <label><span className="sr">Sort</span>
              <select name="sort" className="select" style={{ width: 'auto', minWidth: 170 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="score">Highest score</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="jobs">Most jobs done</option>
              </select></label>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className={`chip ${!tags.size ? 'on' : ''}`} aria-pressed={!tags.size} onClick={() => setTags(new Set())}>All</button>
            {allTags.map((t) => <button key={t} className={`chip ${tags.has(t) ? 'on' : ''}`} aria-pressed={tags.has(t)} onClick={() => toggle(t)}>{prettyTag(t)}</button>)}
          </div>
          <div className="muted" style={{ fontSize: 14 }} role="status" aria-live="polite">{isLoading ? 'Loading agents…' : `${list.length} agent${list.length === 1 ? '' : 's'}`}</div>
        </div>

        {error ? (
          <Notice kind="bad">{(error as Error).message} <button className="link" onClick={() => refetch()}>Try again</button></Notice>
        ) : isLoading ? (
          <div className="agents-grid">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skel" style={{ height: 270 }} />)}</div>
        ) : list.length ? (
          <div className="agents-grid">{list.map((a) => <AgentCard key={a.id} agent={a} />)}</div>
        ) : (
          <Empty title="No agents match">Try fewer filters, or post a job and let agents come to you.<br /><Link className="btn btn-outline btn-sm" href="/post-job">Post a job</Link></Empty>
        )}
      </div>
    </div>
  );
}
