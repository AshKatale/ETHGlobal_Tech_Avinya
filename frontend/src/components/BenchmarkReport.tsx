"use client";
import type { BenchmarkRun } from "@/lib/api";
import { toItems, scoreText } from "@/lib/format";
import { Alert, AuditNotice, Card, CopyButton, ErrorPanel, Mono } from "./ui";

export function ItemList({ items }: { items: unknown }) {
  const list = toItems(items);
  if (!list.length) return null;
  return (
    <ul className="mt-3 space-y-2">
      {list.map((it, i) => (
        <li key={i} className="text-sm">
          <span className={it.passed === true ? "text-success" : it.passed === false ? "text-danger" : "text-muted-foreground"}>
            {it.passed === true ? "✓ Passed" : it.passed === false ? "✕ Failed" : "• Noted"}
          </span>{" "}
          <span className="font-medium">{it.name}</span>
          {it.detail && <span className="block text-muted-foreground">{it.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

export function BenchmarkReport({ run, onRetry }: { run: BenchmarkRun; onRetry?: () => void }) {
  if (run.status === "running")
    return (
      <Card>
        <p role="status" aria-live="polite">Benchmark running. Reading the repository, running code checks, then AI review.</p>
      </Card>
    );
  if (run.status === "error")
    return (
      <div className="space-y-2">
        <ErrorPanel title="Benchmark could not run" detail={run.error ?? undefined} onRetry={onRetry} />
        <p className="text-sm text-muted-foreground">This is not a failed score.</p>
      </div>
    );
  const score = Number.parseFloat(run.score ?? "0"); // display only
  return (
    <Card>
      <h3 className="text-lg font-semibold">Benchmark review</h3>
      <p className="mt-2 text-3xl font-semibold">{scoreText(run.score)} / 100</p>
      <div
        role="progressbar"
        aria-label="Benchmark score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Number.isFinite(score) ? score : 0}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div className={`h-full ${run.status === "passed" ? "bg-success" : "bg-danger"}`} style={{ width: `${Math.min(100, Math.max(0, Number.isFinite(score) ? score : 0))}%` }} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Code checks (40%): {scoreText(run.customScore)}. AI review (60%): {scoreText(run.aiScore)}. Pass mark 80.
      </p>
      <p className={`mt-2 text-sm font-medium ${run.status === "passed" ? "text-success" : "text-danger"}`}>
        {run.status === "passed" ? "✓ Passed the benchmark" : "✕ Score is below 80, so this agent is not listed"}
      </p>
      <ItemList items={run.items} />
      {run.reviewText && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">{run.reviewText}</p>}
      {run.repoCommit && <p className="mt-3 text-sm text-muted-foreground">Benchmarked at commit <span className="font-mono">{run.repoCommit.slice(0, 7)}</span></p>}
      {run.reportRoot ? (
        <p className="mt-2 text-sm">Report stored on 0G: <Mono>{run.reportRoot}</Mono> <CopyButton value={run.reportRoot} /></p>
      ) : (
        <div className="mt-3"><Alert tone="info">Report stored in our database only. 0G upload failed.</Alert></div>
      )}
      <div className="mt-3"><AuditNotice /></div>
    </Card>
  );
}
