"use client";
import type { ReactNode } from "react";
import { Card, CopyButton, HashScanLink, Mono } from "@/components/ui";
import { shorten } from "@/lib/format";
import type { AgreementDetail, Verification } from "@/lib/api";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-2 first:border-t-0">
      <dt className="w-44 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-sm">{children}</dd>
    </div>
  );
}

/** One audit entry from GET /agreements/:id/audit, rendered defensively. */
export interface AuditEntryView {
  id?: string;
  kind?: string;
  [k: string]: unknown;
}

export function AuditPanel({
  d,
  latest,
  auditEntries,
}: {
  d: AgreementDetail;
  latest: Verification | null;
  auditEntries?: AuditEntryView[] | null;
}) {
  const v = d.verdict;
  const sub = d.submission;
  if (!v && !sub) return null;
  const settleTx = v?.settleTxHash ?? d.payments.find((p) => p.kind === "release" || p.kind === "refund")?.txHash ?? null;
  const reportRoot = latest?.reportRoot ?? null;
  return (
    <Card>
      <h2 className="text-lg font-semibold">Audit trail</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Anyone can re-verify this signature on-chain: the escrow contract only pays out for a signature from the platform verifier.
      </p>
      <dl className="mt-3">
        <Row label="Verdict">{v ? <Mono>{v.result}</Mono> : <span className="text-muted-foreground">No verdict yet</span>}</Row>
        <Row label="Verifier signature">
          {v?.verifierSig ? (
            <>
              <Mono>{shorten(v.verifierSig, 12, 8)}</Mono>
              <CopyButton value={v.verifierSig} label="Copy signature" />
            </>
          ) : (
            <span className="text-muted-foreground">Not signed yet</span>
          )}
        </Row>
        <Row label="Nonce">
          {v?.nonce ? (
            <>
              <Mono>{v.nonce}</Mono>
              <CopyButton value={v.nonce} label="Copy nonce" />
            </>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Row>
        <Row label="Deliverable hash">
          {sub ? (
            <>
              <Mono>{shorten(sub.deliverableHash, 12, 8)}</Mono>
              <CopyButton value={sub.deliverableHash} label="Copy hash" />
            </>
          ) : (
            <span className="text-muted-foreground">No submission</span>
          )}
        </Row>
        <Row label="Report root (0G)">
          {reportRoot ? (
            <>
              <Mono>{shorten(reportRoot, 12, 8)}</Mono>
              <CopyButton value={reportRoot} label="Copy report root" />
            </>
          ) : (
            <span className="text-muted-foreground">Stored in database only, 0G not configured</span>
          )}
        </Row>
        <Row label="Escrow contract">
          {d.agreement.escrowAddress ? (
            <>
              <HashScanLink kind="contract" value={d.agreement.escrowAddress} />
              <CopyButton value={d.agreement.escrowAddress} label="Copy address" />
            </>
          ) : (
            <span className="text-muted-foreground">Not deployed yet</span>
          )}
        </Row>
        <Row label="Settle transaction">
          {settleTx ? (
            <>
              <HashScanLink kind="tx" value={settleTx} />
              <CopyButton value={settleTx} label="Copy transaction" />
            </>
          ) : (
            <span className="text-muted-foreground">Not settled yet</span>
          )}
        </Row>
      </dl>
      {auditEntries && auditEntries.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Signature audit log</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {auditEntries.map((e, i) => (
              <li key={String(e.id ?? i)} className="rounded-lg bg-surface-2 p-2">
                <AuditEntry e={e} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function AuditEntry({ e }: { e: AuditEntryView }) {
  const fields = Object.entries(e).filter(([k, val]) => k !== "id" && val !== null && val !== undefined && typeof val !== "object");
  return (
    <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[10rem_1fr]">
      {fields.map(([k, val]) => {
        const s = String(val);
        const long = s.length > 40;
        return (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="flex flex-wrap items-center gap-2 break-all">
              <Mono>{long ? shorten(s, 12, 8) : s}</Mono>
              {long && <CopyButton value={s} />}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
