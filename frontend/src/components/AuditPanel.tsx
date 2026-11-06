"use client";
import type { ReactNode } from "react";
import { Card, CopyButton, HashScanLink, Hbar, Mono } from "@/components/ui";
import { fmtDate, isTinybarString, shorten } from "@/lib/format";
import type { AgreementDetail, AuditEntry, AuditResponse, Verification } from "@/lib/api";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-2 first:border-t-0">
      <dt className="w-44 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-sm">{children}</dd>
    </div>
  );
}

export function AuditPanel({
  d,
  latest,
  auditEntries,
  audit,
}: {
  d: AgreementDetail;
  latest: Verification | null;
  auditEntries?: AuditEntry[] | null;
  audit?: AuditResponse | null;
}) {
  const v = d.verdict;
  const sub = d.submission;
  if (!v && !sub) return null;
  const settleTx = v?.settleTxHash ?? audit?.settleTxHash ?? d.payments.find((p) => p.kind === "release" || p.kind === "refund")?.txHash ?? null;
  const reportRoot = latest?.reportRoot ?? audit?.reportRoot ?? null;
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
            {auditEntries.map((e) => (
              <li key={e.id} className="rounded-lg bg-surface-2 p-2">
                <AuditEntryRow e={e} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function AuditEntryRow({ e }: { e: AuditEntry }) {
  const isVerdict = e.kind === "verdict";
  return (
    <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[10rem_1fr]">
      <dt className="text-muted-foreground">Kind</dt>
      <dd>{isVerdict ? "Verdict signature" : "Delegation (agent paid agent)"}</dd>
      <dt className="text-muted-foreground">Nonce</dt>
      <dd><Mono>{e.nonce}</Mono></dd>
      <dt className="text-muted-foreground">Signer</dt>
      <dd className="flex flex-wrap items-center gap-2 break-all">
        <Mono>{shorten(e.signerAddress, 10, 6)}</Mono>
        <CopyButton value={e.signerAddress} label="Copy signer" />
      </dd>
      <dt className="text-muted-foreground">{isVerdict ? "Result" : "Amount"}</dt>
      <dd>{!isVerdict && isTinybarString(e.resultOrAmount) ? <Hbar value={e.resultOrAmount} /> : <Mono>{e.resultOrAmount}</Mono>}</dd>
      <dt className="text-muted-foreground">Signature sha256</dt>
      <dd className="flex flex-wrap items-center gap-2 break-all">
        <Mono>{shorten(e.sigSha256, 12, 8)}</Mono>
        <CopyButton value={e.sigSha256} label="Copy hash" />
      </dd>
      <dt className="text-muted-foreground">Time</dt>
      <dd>{fmtDate(e.createdAt)}</dd>
    </dl>
  );
}
