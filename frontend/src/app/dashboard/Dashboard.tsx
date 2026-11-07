'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtHbar } from '@/lib/money';
import { ago, shortAddr } from '@/lib/format';
import { txUrl, shortTx } from '@/lib/hashscan';
import { useMe } from '@/lib/queries';
import { useSession } from '@/providers/Session';
import type { Agent, JobRow, MySummary } from '@/lib/types';
import AgentCard from '@/components/AgentCard';
import StatusChip from '@/components/StatusChip';
import Notice, { Empty } from '@/components/Notice';
import { Icon } from '@/components/Icon';

const TABS = [
  { key: 'jobs', label: 'My jobs' },
  { key: 'agent-jobs', label: 'Jobs on my agents' },
  { key: 'agents', label: 'My agents' },
  { key: 'activity', label: 'Activity' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export default function Dashboard() {
  const session = useSession();
  const raw = useSearchParams().get('tab');
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : 'jobs';
  const on = session.signedIn;
  const me = useMe();

  const summary = useQuery({ queryKey: ['summary'], queryFn: () => api<MySummary>('/me/summary', { auth: true }), enabled: on, refetchInterval: 15_000 });
  const jobs = useQuery({ queryKey: ['jobs', 'client'], queryFn: () => api<JobRow[]>('/agreements', { auth: true }), enabled: on && tab === 'jobs', refetchInterval: 10_000 });
  const agentJobs = useQuery({ queryKey: ['jobs', 'agent'], queryFn: () => api<JobRow[]>('/agreements?as=agent', { auth: true }), enabled: on && tab === 'agent-jobs', refetchInterval: 10_000 });
  const agents = useQuery({ queryKey: ['agents', 'mine'], queryFn: () => api<Agent[]>('/agents/mine', { auth: true }), enabled: on && tab === 'agents' });

  if (!session.ready) return <div className="page"><div className="container"><div className="skel" style={{ height: 300 }} /></div></div>;

  if (!on) {
    return (
      <div className="page"><div className="container" style={{ maxWidth: 720 }}>
        <Empty title="Log in to see your dashboard">Your jobs, your agents and your HBAR activity belong to your account.<br /><button className="btn btn-primary" onClick={session.openConnect}><Icon name="lock" />Log in or sign up</button></Empty>
      </div></div>
    );
  }

  const s = summary.data;
  return (
    <div className="page">
      <div className="container">
        <div className="page-head"><div><p className="eyebrow-p">Dashboard</p><h1>Your Attestra</h1><p>{shortAddr(session.address)} · Hedera testnet</p></div>
          <div className="row" style={{ gap: 10 }}><Link className="btn btn-outline" href="/post-job">Post a job</Link><Link className="btn btn-primary" href="/list-agent">List an agent</Link></div></div>

        <div className="tiles" style={{ marginBottom: 28 }}>
          <div className="tile"><span>Locked in your jobs</span><b>{s ? fmtHbar(s.lockedTinybar) : '…'}</b></div>
          <div className="tile"><span>Earned by your agents</span><b className="p">{s ? fmtHbar(s.earnedTinybar) : '…'}</b></div>
          <div className="tile"><span>Active jobs</span><b>{s ? s.activeJobs : '…'}</b></div>
          <div className="tile"><span>Wallet</span><b style={{ fontSize: 18, paddingTop: 6 }} className="mono">{shortAddr(session.address)}</b></div>
        </div>
        {me.data && !me.data.hasPassword && <Notice kind="warn" style={{ marginBottom: 20 }}>Your account is protected by your wallet only. <Link className="link" href="/account">Add an email and password</Link> to require both at login.</Notice>}
        {summary.error && <Notice kind="warn" style={{ marginBottom: 20 }}>Could not load your totals. {(summary.error as Error).message}</Notice>}

        <nav className="tabs" aria-label="Dashboard sections">{TABS.map((t) => <Link key={t.key} href={`/dashboard?tab=${t.key}`} className={`tab ${tab === t.key ? 'on' : ''}`} aria-current={tab === t.key ? 'page' : undefined}>{t.label}</Link>)}</nav>

        {tab === 'jobs' && <JobList q={jobs} empty="You have not hired anyone yet." cta={<Link className="btn btn-primary btn-sm" href="/post-job">Post a job</Link>} />}
        {tab === 'agent-jobs' && <JobList q={agentJobs} showClient empty="Nobody has hired your agents yet." cta={<Link className="btn btn-outline btn-sm" href="/marketplace">View the marketplace</Link>} />}

        {tab === 'agents' && (
          agents.isLoading ? <div className="skel" style={{ height: 200 }} />
          : agents.error ? <Notice kind="bad">{(agents.error as Error).message}</Notice>
          : agents.data?.length ? <div className="agents-grid">{agents.data.map((a) => (
              <div key={a.id} className="stack" style={{ gap: 8 }}>
                <AgentCard agent={a} mine />
                <div className="row between"><span className={`status ${a.status === 'listed' ? 's-ok' : a.status === 'failed' ? 's-bad' : 's-idle'}`}>{a.status === 'failed' ? 'not listed · below 80' : a.status}</span>
                  <Link className="btn btn-ghost btn-sm" href={`/list-agent?agent=${a.id}`}>Re-run benchmark</Link></div>
              </div>))}</div>
          : <Empty title="You have not listed an agent">Connect a GitHub repo, pass the benchmark and your agent appears in the marketplace.<br /><Link className="btn btn-primary btn-sm" href="/list-agent">List an agent</Link></Empty>
        )}

        {tab === 'activity' && (
          summary.isLoading ? <div className="skel" style={{ height: 200 }} />
          : s?.activity.length ? (
            <div className="card"><div className="list">{s.activity.map((a, i) => {
              const amt = BigInt(a.amountTinybar);
              return (
                <div key={i} className="li"><span className={amt < 0n ? 'ico-wait' : 'ico-ok'}><Icon name={amt < 0n ? 'arrow' : 'check'} /></span>
                  <div>{a.text}<span className="sub">{ago(a.at)}{a.txId ? <> · <a className="link mono" href={txUrl(a.txId)} target="_blank" rel="noopener noreferrer">{shortTx(a.txId)}</a></> : null}</span></div>
                  <b className={amt > 0n ? 'text-primary' : undefined}>{amt === 0n ? '' : `${amt > 0n ? '+' : ''}${fmtHbar(amt)}`}</b></div>);
            })}</div></div>
          ) : <Empty title="No HBAR movements yet">Funding, payouts and refunds will show up here.</Empty>
        )}
      </div>
    </div>
  );
}

/** A job the client has accepted but not funded yet. Only meaningful on the client's own list. */
const needsAction = (j: JobRow, agentView?: boolean) => !agentView && j.status === 'agreed';

function JobList({ q, empty, cta, showClient }: { q: { isLoading: boolean; error: unknown; data?: JobRow[] }; empty: string; cta: React.ReactNode; showClient?: boolean }) {
  if (q.isLoading) return <div className="skel" style={{ height: 200 }} />;
  if (q.error) return <Notice kind="bad">{(q.error as Error).message}</Notice>;
  if (!q.data?.length) return <Empty title={empty}>{cta}</Empty>;
  // Jobs that wait on the client (not yet funded) come first, then newest.
  const rows = [...q.data].sort((x, y) => Number(needsAction(y, showClient)) - Number(needsAction(x, showClient)) || +new Date(y.createdAt) - +new Date(x.createdAt));
  return (
    <div className="card"><div className="list">{rows.map((j) => (
      <Link key={j.id} className="li" href={`/jobs/${j.id}`}>
        <span className="mono muted">{j.id.slice(0, 6)}</span>
        <div>{j.title}<span className="sub">{j.agentName}{showClient && j.clientAddress ? ` · client ${shortAddr(j.clientAddress)}` : ''} · {fmtHbar(j.priceTinybar)} · {ago(j.createdAt)}</span></div>
        <span className="row" style={{ gap: 8 }}>
          {needsAction(j, showClient) && <span className="status s-warn">Needs funding</span>}
          <StatusChip status={j.status} />
        </span>
      </Link>))}</div></div>
  );
}
