"use client";
import { Alert, CopyButton, HashScanLink, Hbar } from "@/components/ui";
import type { A2aCall, AgreementDetail } from "@/lib/api";


/**
 * The three demo moments on the job page:
 * (a) agent paid agent, (b) over-budget payment blocked, (c) refund on failed work.
 * An infrastructure ERROR is never shown here as a failure.
 */
export function DemoMoments({
  d,
  calls,
  capPercent,
}: {
  d: AgreementDetail;
  calls: A2aCall[];
  capPercent: number | null;
}) {
  const a = d.agreement;
  const paid = (calls as A2aCall[]).filter((c) => c.status === "paid" || c.status === "done");
  const blocked = (calls as A2aCall[]).filter((c) => c.status === "blocked");
  const refund = d.payments.find((p) => p.kind === "refund");
  const failedVerdict = d.verdict?.result === "FAIL";
  const refunded = a.status === "refunded";
  const name = (c: A2aCall, side: "caller" | "callee") =>
    (side === "caller" ? c.callerName : c.calleeName) ?? "An agent";

  if (paid.length === 0 && blocked.length === 0 && !refunded) return null;
  return (
    <div className="space-y-3" aria-label="Key moments">
      {paid.map((c, i) => {
        const tx = c.txHash ?? null;
        return (
          <div key={c.id} className="rounded-lg border border-success/40 bg-success/10 p-4 text-sm">
            <p className="font-semibold">Agent paid agent{paid.length > 1 ? ` (${i + 1})` : ""}</p>
            <p className="mt-1">
              <strong>{name(c, "caller")}</strong> paid <strong>{name(c, "callee")}</strong> <Hbar value={c.priceTinybar} /> out of the escrow
              {c.status === "done" ? " and received the result." : "."}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2">
              {tx ? (
                <>
                  <span className="text-muted-foreground">Matched transaction:</span>
                  <HashScanLink kind="tx" value={tx} />
                  <CopyButton value={tx} label="Copy transaction" />
                </>
              ) : (
                <span className="text-muted-foreground">Transaction link appears in the Payments table once confirmed.</span>
              )}
            </p>
          </div>
        );
      })}
      {blocked.map((c) => (
        <div key={c.id} role="status" className="rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
          <p className="font-semibold">Blocked by the {capPercent ?? "budget"}{capPercent ? "%" : ""} budget rule</p>
          <p className="mt-1">
            <strong>{name(c, "caller")}</strong> tried to pay <strong>{name(c, "callee")}</strong> <Hbar value={c.priceTinybar} />. No money moved.
          </p>
          <p className="mt-1 text-muted-foreground">Reason: {c.blockedReason ?? "no reason given"}</p>
        </div>
      ))}
      {refunded && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm">
          <p className="font-semibold">
            {failedVerdict ? "Work failed verification, funds returned to the client" : "Funds returned to the client"}
          </p>
          <p className="mt-1">
            {refund ? <><Hbar value={refund.amountTinybar} /> went back to the buyer.</> : "The refund is being recorded."}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            {(refund?.txHash ?? d.verdict?.settleTxHash) ? (
              <>
                <HashScanLink kind="tx" value={refund?.txHash ?? d.verdict?.settleTxHash} />
                <CopyButton value={(refund?.txHash ?? d.verdict?.settleTxHash)!} label="Copy transaction" />
              </>
            ) : (
              <span className="text-muted-foreground">Transaction link not available yet.</span>
            )}
          </p>
        </div>
      )}
      {!refunded && failedVerdict && <Alert tone="warning">Verdict is FAIL. The refund is waiting for on-chain confirmation.</Alert>}
    </div>
  );
}
