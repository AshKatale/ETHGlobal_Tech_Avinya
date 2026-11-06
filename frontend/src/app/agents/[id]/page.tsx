"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BenchmarkReport } from "@/components/BenchmarkReport";
import { Badge, ButtonLink, Card, CopyButton, EmptyState, HashScanLink, Hbar, Mono, PageSkeleton, QueryError, SeededBadge } from "@/components/ui";
import { useApi, useMe } from "@/hooks/useApi";
import type { Agent, BenchmarkRun } from "@/lib/api";

const tone = { listed: "success", benchmarking: "info", failed: "danger", draft: "neutral" } as const;

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<{ agent: Agent; benchmark: BenchmarkRun | null }>(["agent", id], `/agents/${id}`, {
    poll: (d) => d?.benchmark?.status === "running",
  });
  const me = useMe();
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError) {
    if (q.error.status === 404)
      return <EmptyState title="Agent not found" action={<ButtonLink href="/">Back to marketplace</ButtonLink>} />;
    return <QueryError error={q.error} title="Could not load agent" onRetry={() => q.refetch()} />;
  }
  const { agent, benchmark } = q.data!;
  const isOwner = me.data?.id === agent.ownerUserId;
  return (
    <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold">{agent.name}</h1>
          {agent.isSeeded && <SeededBadge />}
          <Badge tone={tone[agent.status]}>{agent.status}</Badge>
        </div>
        <p className="whitespace-pre-wrap">{agent.description}</p>
        <div className="flex flex-wrap gap-1">{agent.capabilities.map((c) => <Badge key={c}>{c}</Badge>)}</div>
        <Card>
          <dl className="grid gap-2 text-sm">
            {agent.repoUrl && (
              <div><dt className="text-muted-foreground">Repository</dt><dd><a className="text-primary underline" href={agent.repoUrl} target="_blank" rel="noopener noreferrer">{agent.repoUrl}</a></dd></div>
            )}
            {agent.repoCommit && <div><dt className="text-muted-foreground">Benchmarked at commit</dt><dd className="font-mono">{agent.repoCommit.slice(0, 7)}</dd></div>}
            <div><dt className="text-muted-foreground">Payout address</dt><dd className="flex flex-wrap items-center gap-2"><Mono>{agent.payoutAddress}</Mono><CopyButton value={agent.payoutAddress} /><HashScanLink kind="account" value={agent.payoutAddress} /></dd></div>
            {agent.hederaAccountId && <div><dt className="text-muted-foreground">Hedera account</dt><dd className="font-mono">{agent.hederaAccountId}</dd></div>}
          </dl>
        </Card>
        {benchmark ? (
          <BenchmarkReport run={benchmark} onRetry={() => q.refetch()} />
        ) : (
          <Card>
            <p>Not benchmarked yet.</p>
            {isOwner && <div className="mt-3"><Link className="text-primary underline" href="/agents/new">Run benchmark</Link></div>}
          </Card>
        )}
      </div>
      <aside>
        <Card className="md:sticky md:top-4">
          <h2 className="text-lg font-semibold">Hire this agent</h2>
          <p className="mt-2">Base price <Hbar value={agent.priceTinybar} /></p>
          <div className="mt-4"><ButtonLink href={`/requests/new?agent=${agent.id}`}>Create a request for this agent</ButtonLink></div>
        </Card>
      </aside>
    </div>
  );
}
