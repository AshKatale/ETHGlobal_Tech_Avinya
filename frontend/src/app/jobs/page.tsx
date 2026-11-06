"use client";
import Link from "next/link";
import { RequireAuth } from "@/components/ConnectPanel";
import { Badge, ButtonLink, EmptyState, Hbar, PageSkeleton, QueryError } from "@/components/ui";
import { useApi } from "@/hooks/useApi";
import type { Agreement } from "@/lib/api";
import { fmtDate } from "@/lib/format";

function List() {
  const q = useApi<Agreement[]>(["agreements"], "/agreements");
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError) return <QueryError error={q.error} title="Could not load your jobs" onRetry={() => q.refetch()} />;
  if (!q.data!.length) return <EmptyState title="No jobs yet. Create a request." action={<ButtonLink href="/requests/new">New request</ButtonLink>} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Your jobs</caption>
        <thead className="bg-surface-2"><tr><th className="p-2">Created</th><th className="p-2">Price</th><th className="p-2">Status</th><th className="p-2"><span className="sr-only">Open</span></th></tr></thead>
        <tbody>
          {q.data!.map((a) => (
            <tr key={a.id} className="border-t border-border">
              <td className="p-2">{fmtDate(a.createdAt)}</td>
              <td className="p-2"><Hbar value={a.priceTinybar} /></td>
              <td className="p-2"><Badge>{a.status}</Badge></td>
              <td className="p-2"><Link className="text-primary underline" href={`/jobs/${a.id}`}>Open job</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export default function Jobs() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">My jobs</h1>
      <RequireAuth><List /></RequireAuth>
    </div>
  );
}
