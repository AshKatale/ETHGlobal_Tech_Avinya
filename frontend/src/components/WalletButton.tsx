"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { shorten } from "@/lib/format";
import { Button } from "./ui";

export function WalletButton() {
  const w = useWallet();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className="inline-block h-11 w-32" aria-hidden />;
  if (!w.isConnected) return <Link href="/connect" className="inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Connect wallet</Link>;
  if (!w.onHedera)
    return <Button variant="secondary" onClick={w.switchNetwork} className="text-warning">Wrong network: switch</Button>;
  if (!w.signedIn) return <Link href="/connect" className="inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Sign in</Link>;
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-sm" title={w.address}>{w.address ? shorten(w.address) : ""}</span>
      <Button variant="secondary" onClick={w.signOut}>Sign out</Button>
    </div>
  );
}
