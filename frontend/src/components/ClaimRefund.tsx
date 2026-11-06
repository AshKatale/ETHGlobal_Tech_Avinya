"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CopyButton, HashScanLink, QueryError } from "@/components/ui";
import { api, ApiError, type RefundTimeoutResponse } from "@/lib/api";
import { formatCountdown, remainingSecondsFrom } from "@/lib/format";

type Outcome =
  | { kind: "wait"; until: number }
  | { kind: "v1" }
  | { kind: "sent"; txHash: string | null; inProgress: boolean }
  | { kind: "error"; error: unknown };

/**
 * Stuck-escrow control (POST /agreements/:id/refund-timeout). Shown to the client or agent owner while
 * the job is submitted or verifying. Never marks anything refunded locally: the indexer sets `refunded`.
 */
export function ClaimRefund({ agreementId }: { agreementId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Outcome | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (out?.kind !== "wait") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [out]);

  async function claim() {
    setBusy(true);
    setOut(null);
    try {
      const r = await api<RefundTimeoutResponse>(`/agreements/${agreementId}/refund-timeout`, { method: "POST", body: {} });
      setOut({ kind: "sent", txHash: r.txHash ?? null, inProgress: Boolean(r.inProgress) });
      await qc.invalidateQueries({ queryKey: ["agreement", agreementId] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const rem = remainingSecondsFrom(e.body);
        if (rem !== null) setOut({ kind: "wait", until: Date.now() + rem * 1000 });
        else setOut({ kind: "error", error: e });
      } else if (e instanceof ApiError && e.status === 501) {
        setOut({ kind: "v1" });
      } else {
        setOut({ kind: "error", error: e });
      }
      setNow(Date.now());
    } finally {
      setBusy(false);
    }
  }

  const remaining = out?.kind === "wait" ? Math.max(0, Math.ceil((out.until - now) / 1000)) : 0;
  return (
    <Card>
      <h2 className="text-lg font-semibold">No verdict yet? Claim your refund</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        If no verdict arrives within the review window, the client can get the escrow back. The status changes to refunded only after the backend confirms the on-chain refund.
      </p>
      <div className="mt-3">
        <Button variant="secondary" onClick={claim} disabled={busy}>{busy ? "Sending..." : "Claim refund"}</Button>
      </div>
      <div className="mt-3" aria-live="polite">
        {out?.kind === "wait" && (
          <Alert tone="info">
            {remaining > 0 ? `The review window has not passed yet. Try again in ${formatCountdown(remaining)}.` : "The review window should have passed. Try claiming again."}
          </Alert>
        )}
        {out?.kind === "v1" && <Alert tone="warning">This escrow is an older type that cannot use the timeout refund.</Alert>}
        {out?.kind === "sent" && (
          <Alert tone="success" title={out.inProgress ? "A refund is already being sent" : "Refund transaction sent"}>
            <span className="flex flex-wrap items-center gap-2">
              {out.txHash ? (
                <>
                  <HashScanLink kind="tx" value={out.txHash} />
                  <CopyButton value={out.txHash} label="Copy transaction" />
                </>
              ) : null}
              <span>Waiting for confirmation. The status updates when the backend indexes the refund.</span>
            </span>
          </Alert>
        )}
        {out?.kind === "error" && <QueryError error={out.error} title="Could not claim the refund" />}
      </div>
    </Card>
  );
}
