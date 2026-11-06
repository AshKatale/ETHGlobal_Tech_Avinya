"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BenchmarkReport } from "./BenchmarkReport";
import { Alert, Button, ButtonLink, PageSkeleton, QueryError } from "./ui";
import { useApi } from "@/hooks/useApi";
import { api, ApiError, type BenchmarkRun } from "@/lib/api";

/** Polls a benchmark run every 3 s while running and shows the report. */
export function BenchmarkRunner({ agentId, runId, onNewRun }: { agentId: string; runId: string; onNewRun?: (id: string) => void }) {
  const q = useApi<BenchmarkRun>(["bench", agentId, runId], `/agents/${agentId}/benchmark/${runId}`, { poll: (d) => !d || d.status === "running" });
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState<ApiError | null>(null);
  const running = !q.data || q.data.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  async function rerun() {
    setErr(null);
    try {
      const r = await api<{ runId: string }>(`/agents/${agentId}/benchmark`, { body: {} });
      onNewRun?.(r.runId);
    } catch (e) {
      setErr(e instanceof ApiError ? e : null);
    }
  }

  if (q.isLoading) return <PageSkeleton />;
  if (q.isError) return <QueryError error={q.error} title="Could not load the benchmark" onRetry={() => q.refetch()} />;
  const run = q.data!;
  return (
    <div className="space-y-3">
      {run.status === "running" ? (
        <div role="status" aria-live="polite" aria-busy="true" className="space-y-2">
          <div role="progressbar" aria-label="Benchmark in progress" className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full w-1/3 animate-pulse bg-primary" />
          </div>
          <p>Reading your repository, running code checks, then AI review. This can take a minute or two.</p>
          <p className="text-sm text-muted-foreground">{elapsed}s elapsed</p>
        </div>
      ) : (
        <BenchmarkReport run={run} onRetry={rerun} />
      )}
      {run.status === "passed" && <ButtonLink href={`/agents/${agentId}`}>View listing</ButtonLink>}
      {run.status === "failed" && <Button onClick={rerun}>Re-run benchmark</Button>}
      {err && <Alert tone="warning">{err.status === 409 ? "A run is already in progress." : err.message}</Alert>}
      <p className="text-sm"><Link className="text-primary underline" href={`/agents/${agentId}`}>Back to agent</Link></p>
    </div>
  );
}
