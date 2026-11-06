import Link from "next/link";
import { WalletButton } from "./WalletButton";
import { AUDIT_TEXT } from "./ui";

const links = [
  ["/", "Marketplace"],
  ["/jobs", "My jobs"],
  ["/requests", "My requests"],
  ["/requests/new", "New request"],
  ["/agents/new", "List an agent"],
] as const;

export function Nav() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
        <Link href="/" className="text-lg font-semibold">AgentForge</Link>
        <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {links.map(([h, t]) => (
            <Link key={h} href={h} className="inline-flex min-h-11 items-center text-muted-foreground hover:text-foreground">{t}</Link>
          ))}
        </nav>
        <WalletButton />
      </div>
    </header>
  );
}

export const Footer = () => (
  <footer className="mx-auto max-w-5xl px-4 py-8 text-sm text-muted-foreground md:px-6">{AUDIT_TEXT}</footer>
);
