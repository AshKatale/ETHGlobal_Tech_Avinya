"use client";
import type { ReactNode } from "react";
import { hederaTestnet } from "@/lib/chain";
import { useWallet, type StepState } from "@/hooks/useWallet";
import { shorten } from "@/lib/format";
import { Alert, Button, Card, HashScanLink } from "./ui";

const label: Record<StepState, string> = { todo: "Not started", active: "Waiting for wallet...", done: "Done", error: "Failed" };

function Step({ n, title, state, error, children }: { n: number; title: string; state: StepState; error?: string; children?: ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-current={state === "active" ? "step" : undefined}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">
          {n}. {title}
        </p>
        <span className={`text-sm ${state === "done" ? "text-success" : state === "error" ? "text-danger" : "text-muted-foreground"}`}>
          {state === "done" ? "✓ " : state === "error" ? "✕ " : ""}
          {label[state]}
        </span>
      </div>
      {state === "error" && error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {children}
    </li>
  );
}

export function ConnectPanel({ onDone }: { onDone?: () => void }) {
  const w = useWallet();
  const done = w.signedIn && w.isConnected && w.onHedera;
  return (
    <Card className="mx-auto max-w-xl">
      <h2 className="text-xl font-semibold">Connect and sign in</h2>
      {!w.hasWallet && (
        <div className="mt-4">
          <Alert tone="warning" title="No EVM wallet found.">
            Install <a className="underline" href="https://metamask.io" target="_blank" rel="noopener noreferrer">MetaMask</a> and reload.
          </Alert>
        </div>
      )}
      <ol className="mt-4 space-y-3" aria-live="polite">
        <Step n={1} title="Connect wallet" state={w.steps.connect} error={w.error?.step === "connect" ? w.error.message : undefined}>
          {w.address ? (
            <p className="break-all font-mono text-sm">{w.address}</p>
          ) : (
            <Button onClick={w.connect} disabled={!w.hasWallet || w.busy !== null}>
              {w.busy === "connect" ? "Check your wallet..." : "Connect wallet"}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">Use an ECDSA Hedera account (create it in the Hedera Portal).</p>
        </Step>
        <Step n={2} title={`Switch to ${hederaTestnet.name} (chain ${hederaTestnet.id})`} state={w.steps.network} error={w.error?.step === "network" ? w.error.message : undefined}>
          {!w.onHedera && (
            <Button variant="secondary" onClick={w.switchNetwork} disabled={!w.isConnected || w.busy !== null}>
              {w.busy === "network" ? "Check your wallet..." : "Switch to Hedera Testnet"}
            </Button>
          )}
          <a className="text-sm text-primary underline" href="https://hashscan.io/testnet" target="_blank" rel="noopener noreferrer">
            Hedera Testnet on HashScan
          </a>
        </Step>
        <Step n={3} title="Sign in (sign message)" state={w.steps.sign} error={w.error?.step === "sign" ? w.error.message : undefined}>
          {!w.signedIn && (
            <Button onClick={w.signIn} disabled={!w.isConnected || !w.onHedera || w.busy !== null}>
              {w.busy === "sign" ? "Check your wallet..." : "Sign in"}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">Signing a message is free and does not move funds.</p>
        </Step>
      </ol>
      {done && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-success">Signed in as {w.address ? shorten(w.address) : ""}</p>
          {onDone && <Button onClick={onDone}>Continue</Button>}
        </div>
      )}
      {w.address && <div className="mt-2 text-xs"><HashScanLink kind="account" value={w.address} /></div>}
    </Card>
  );
}

/** Shows children once signed in; otherwise the connect panel. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const w = useWallet();
  if (!w.signedIn) return <ConnectPanel />;
  return <>{children}</>;
}
