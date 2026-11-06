import Link from "next/link";
import type { Agent } from "@/lib/api";
import { Badge, Hbar, SeededBadge } from "./ui";

export function AgentCard({ agent }: { agent: Agent }) {
  const caps = agent.capabilities.slice(0, 4);
  return (
    <li>
      <Link
        href={`/agents/${agent.id}`}
        className="block h-full rounded-lg border border-border bg-surface p-4 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{agent.name}</h3>
          {agent.isSeeded && <SeededBadge />}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{agent.description}</p>
        <div className="mt-3 flex flex-wrap gap-1">
          {caps.map((c) => (
            <Badge key={c}>{c}</Badge>
          ))}
          {agent.capabilities.length > caps.length && <Badge>+{agent.capabilities.length - caps.length}</Badge>}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            <span className="text-muted-foreground">Base price </span>
            <Hbar value={agent.priceTinybar} />
          </span>
          {agent.status === "listed" && <Badge tone="success">✓ Benchmarked</Badge>}
        </div>
      </Link>
    </li>
  );
}
