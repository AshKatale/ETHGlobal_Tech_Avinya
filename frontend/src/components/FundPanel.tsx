"use client";
import { useState } from "react";
import Link from "next/link";
import { parseAbi, type Address, type Hash } from "viem";
import { useWriteContract } from "wagmi";
import { useApi, useMe } from "@/hooks/useApi";
import { useWallet } from "@/hooks/useWallet";
import { api, ApiError, type AgreementDetail } from "@/lib/api";
import { hederaTestnet } from "@/lib/chain";
import { toRpcValue } from "@/lib/money";
import { Alert, Button, ButtonLink, Card, ChainStatus, ErrorPanel, HashScanLink, Hbar, PageSkeleton, QueryError } from "./ui";

// fund() is payable with no args (contracts/abi/JobEscrow.json). It is the only contract call the frontend makes.
const escrowAbi = parseAbi(["function fund() payable"]);
// Hedera's relay needs an explicit gas limit; fund() is a plain payable.
const FUND_GAS = 400_000n;

function Row({ done, text, children }: { done: boolean; text: string; children?: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p className={done ? "text-success" : ""}>{done ? "✓ " : "• "}{text}</p>
      {children}
    </li>
  );
}

export function FundPanel({ agreementId }: { agreementId: string }) {
  const q = useApi<AgreementDetail>(["agreement", agreementId], `/agreements/${agreementId}`, {
    poll: (d) => d?.agreement.status === "agreed",
  });
  const w = useWallet();
  const me = useMe();
  const { writeContractAsync } = useWriteContract();
  const [hash, setHash] = useState<Hash | null>(null);
  const [sendState, setSendState] = useState<"idle" | "wallet" | "error">("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [waitStart, setWaitStart] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [escrowErr, setEscrowErr] = useState<string | null>(null);

  if (q.isLoading) return <PageSkeleton />;
  if (q.isError) return <QueryError error={q.error} title="Could not load the agreement" onRetry={() => q.refetch()} />;
  const { agreement: a, payments } = q.data!;
  const isClient = Boolean(me.data && me.data.id === a.clientUserId);
  const fundPayment = payments.find((p) => p.kind === "fund");
  const funded = a.status !== "agreed";
  const walletMatches = Boolean(w.address && me.data && w.address.toLowerCase() === me.data.address.toLowerCase());
  const txHash = hash ?? fundPayment?.txHash ?? null;
  const stillWaiting = !funded && waitStart !== null && Date.now() - waitStart > 90_000;

  async function retryEscrow() {
    setRetrying(true);
    setEscrowErr(null);
    try {
      await api(`/agreements/${a.id}/escrow`, { method: "POST", body: {} });
      await q.refetch();
    } catch (e) {
      setEscrowErr(e instanceof ApiError ? e.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  }

  async function fund() {
    if (!a.escrowAddress) return;
    setSendState("wallet");
    setSendError(null);
    try {
      const h = await writeContractAsync({
        address: a.escrowAddress as Address,
        abi: escrowAbi,
        functionName: "fund",
        value: toRpcValue(BigInt(a.priceTinybar)),
        gas: FUND_GAS,
        chainId: hederaTestnet.id,
      });
      setHash(h);
      setWaitStart(Date.now());
      setSendState("idle");
    } catch (e) {
      const err = e as { code?: number; shortMessage?: string; message?: string };
      setSendState("error");
      setSendError(
        err?.code === 4001 || /rejected|denied/i.test(err?.message ?? "")
          ? "You rejected the transaction. No funds moved."
          : /insufficient/i.test(err?.message ?? "")
            ? "Not enough HBAR in this account."
            : `The Hedera relay did not accept the transaction. Your funds did not move. ${err?.shortMessage ?? ""}`,
      );
    }
  }

  return (
    <Card>
      <h2 className="text-xl font-semibold">Fund escrow</h2>
      <ol className="mt-4 space-y-3" aria-live="polite">
        <Row done={Boolean(a.escrowAddress)} text="Escrow contract created">
          {a.escrowAddress ? (
            <HashScanLink kind="contract" value={a.escrowAddress} />
          ) : (
            <>
              <Alert tone="warning" title="The escrow contract could not be created yet.">{escrowErr ?? "Retry to create it."}</Alert>
              {isClient && <Button variant="secondary" onClick={retryEscrow} disabled={retrying}>{retrying ? "Retrying..." : "Retry"}</Button>}
            </>
          )}
        </Row>
        {isClient && !funded && (
          <>
            <Row done={w.onHedera} text="Wallet on Hedera Testnet">
              {!w.isConnected ? <Link className="text-primary underline" href="/connect">Connect wallet</Link> : !w.onHedera && <Button variant="secondary" onClick={w.switchNetwork}>Switch to Hedera Testnet</Button>}
            </Row>
            <Row done={walletMatches} text="Wallet matches the buyer account">
              {w.isConnected && !walletMatches && <p className="text-sm text-warning">Connect the wallet you signed in with.</p>}
            </Row>
          </>
        )}
        <Row done={funded} text={funded ? "Escrow funded" : "Fund escrow"}>
          <p className="text-sm">Price <Hbar value={a.priceTinybar} />. {isClient && !funded ? "Your wallet will ask you to send exactly this amount." : ""}</p>
          {isClient && !funded && !txHash && (
            <Button onClick={fund} disabled={!a.escrowAddress || !w.onHedera || !walletMatches || sendState === "wallet"}>
              {sendState === "wallet" ? "Check your wallet..." : <>Fund escrow (<Hbar value={a.priceTinybar} />)</>}
            </Button>
          )}
          {!isClient && !funded && <p className="text-sm text-muted-foreground">Only the buyer can fund this escrow.</p>}
          {sendError && <ErrorPanel title="Funding did not go through" detail={sendError} onRetry={() => { setSendError(null); setSendState("idle"); }} />}
          {txHash && (
            <div className="flex flex-wrap items-center gap-2">
              <HashScanLink kind="tx" value={txHash} />
              <ChainStatus state={funded ? "confirmed" : "pending"} />
            </div>
          )}
          {stillWaiting && (
            <Alert tone="info">
              Still waiting. Your transaction may be confirmed on HashScan; this page will update when our indexer sees it.
              <div className="mt-2"><Button variant="secondary" onClick={() => q.refetch()}>Check again</Button></div>
            </Alert>
          )}
          {funded && <ButtonLink href={`/jobs/${a.id}`}>Go to job</ButtonLink>}
        </Row>
      </ol>
    </Card>
  );
}
