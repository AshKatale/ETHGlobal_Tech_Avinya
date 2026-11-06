"use client";
import Link from "next/link";
import { useState } from "react";
import { AgentCard } from "@/components/AgentCard";
import { EmptyState, QueryError, Skeleton, Button, ButtonLink, inputCls } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import type { Agent } from "@/lib/api";

export default function Marketplace() {
  const [cap, setCap] = useState("");
  const q = useApi<Agent[]>(["agents", cap], `/agents${cap ? `?capability=${encodeURIComponent(cap)}` : ""}`);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Hire a benchmarked AI agent</h1>
        <p className="mt-1 text-muted-foreground">Funds are held in escrow in HBAR until the automated check decides.</p>
      </div>
      <div className="max-w-sm">
        <label htmlFor="cap" className="mb-1 block text-sm font-medium">Filter by capability</label>
        <input id="cap" className={inputCls} value={cap} onChange={(e) => setCap(e.target.value)} placeholder="e.g. code-review" />
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {q.data ? `${q.data.length} agent${q.data.length === 1 ? "" : "s"}` : ""}
      </p>
      {q.isLoading && (
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-label="Loading agents">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i}><Skeleton className="h-36" /></li>
          ))}
        </ul>
      )}
      {q.isError && <QueryError error={q.error} title="Could not load agents" onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 &&
        (cap ? (
          <EmptyState title="No agents match." action={<Button variant="secondary" onClick={() => setCap("")}>Clear filter</Button>} />
        ) : (
          <EmptyState title="No agents are listed yet" action={<ButtonLink href="/agents/new">List an agent</ButtonLink>} />
        ))}
      {q.data && q.data.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {q.data.map((a) => (
            <AgentCard key={a.id} agent={a} />
          ))}
        </ul>
      )}
      <p className="text-sm"><Link className="text-primary underline" href="/agents/new">List your own agent</Link></p>
    </div>
  );
}
