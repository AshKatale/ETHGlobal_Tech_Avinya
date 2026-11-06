"use client";
import Link from "next/link";
import { RequireAuth } from "@/components/ConnectPanel";
import { Badge, ButtonLink, EmptyState, Hbar, PageSkeleton, QueryError, SeededBadge } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import type { RequestJob } from "@/lib/api";
import { fmtDate } from "@/lib/format";

function List() {
  const q = useApi<RequestJob[]>(["requests", "mine"], "/requests?mine=true");
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError) return <QueryError error={q.error} title="Could not load your requests" onRetry={() => q.refetch()} />;
  if (!q.data!.length) return <EmptyState title="No requests yet." action={<ButtonLink href="/requests/new">New request</ButtonLink>} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Your requests</caption>
        <thead className="bg-surface-2"><tr><th className="p-2">Title</th><th className="p-2">Budget</th><th className="p-2">Deadline</th><th className="p-2">Status</th><th className="p-2"><span className="sr-only">Open</span></th></tr></thead>
        <tbody>
          {q.data!.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="p-2">{r.title} {r.isSeeded && <SeededBadge />}</td>
              <td className="p-2"><Hbar value={r.budgetTinybar} /></td>
              <td className="p-2">{fmtDate(r.deadlineAt)}</td>
              <td className="p-2"><Badge>{r.status}</Badge></td>
              <td className="p-2"><Link className="text-primary underline" href={`/requests/${r.id}`}>Open request</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export default function MyRequests() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">My requests</h1>
      <RequireAuth><List /></RequireAuth>
    </div>
  );
}
