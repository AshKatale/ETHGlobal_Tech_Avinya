"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RequireAuth } from "@/components/ConnectPanel";
import { Button, Card, ErrorPanel, Field, Hbar, inputCls } from "@/components/ui";
import { api, ApiError, type RequestJob } from "@/lib/api";
import { parseHbarInput } from "@/lib/format";

const CHECKS: [string, string][] = [
  ["build_config", "Build config"],
  ["lint_rules", "Lint rules"],
  ["secrets_scan", "Secrets scan"],
  ["dependency_check", "Dependency check"],
  ["security_review", "Security review"],
];

function Form() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [requirements, setRequirements] = useState("");
  const [checks, setChecks] = useState<string[]>([]);
  const [budget, setBudget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const tiny = parseHbarInput(budget);
  const fieldErr = (f: string) => err?.issues?.find((i) => i.path[0] === f)?.message;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!tiny) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<RequestJob>("/requests", {
        body: {
          title,
          requirements,
          checksRequested: checks,
          budgetTinybar: tiny,
          ...(deadline ? { deadlineAt: new Date(deadline).toISOString() } : {}),
        },
      });
      router.push(`/requests/${r.id}`);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, "Unexpected error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Create a request</h1>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field label="Title" id="title" error={fieldErr("title")}>
          <input id="title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        </Field>
        <Field label="Requirements" id="req" hint={`${requirements.length} / 10000 (minimum 10)`} error={fieldErr("requirements")}>
          <textarea id="req" className={inputCls} rows={6} value={requirements} onChange={(e) => setRequirements(e.target.value)} maxLength={10000} required />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Checks to run</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {CHECKS.map(([v, l]) => (
              <label key={v} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" className="size-4" checked={checks.includes(v)} onChange={(e) => setChecks(e.target.checked ? [...checks, v] : checks.filter((c) => c !== v))} />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Budget (HBAR)" id="budget" hint="Up to 8 decimals, e.g. 5 or 1.5" error={budget && !tiny ? "Enter a valid HBAR amount." : fieldErr("budgetTinybar")}>
          <input id="budget" className={inputCls} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} required />
          {tiny && <p className="mt-1 text-sm">= <Hbar value={tiny} /></p>}
        </Field>
        <Field label="Deadline (optional)" id="deadline" error={fieldErr("deadlineAt")}>
          <input id="deadline" type="datetime-local" className={inputCls} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </Field>
        {err && (err.isInfra ? <ErrorPanel title="Could not create the request" detail={err.message} /> : <p role="alert" className="text-sm text-danger">{err.message}</p>)}
        <Button type="submit" disabled={busy || !tiny || title.length === 0 || requirements.length < 10}>{busy ? "Creating..." : "Create request"}</Button>
      </form>
    </Card>
  );
}

export default function NewRequest() {
  return (
    <RequireAuth>
      <Form />
    </RequireAuth>
  );
}
