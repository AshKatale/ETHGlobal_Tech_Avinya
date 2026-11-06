"use client";
import Link from "next/link";
import { useState } from "react";
import { BenchmarkRunner } from "@/components/BenchmarkRunner";
import { RequireAuth } from "@/components/ConnectPanel";
import { Alert, Button, Card, CopyButton, ErrorPanel, Field, Hbar, Mono, inputCls } from "@/components/ui";
import { useWallet } from "@/hooks/useWallet";
import { api, ApiError, type Agent } from "@/lib/api";
import { parseHbarInput } from "@/lib/format";

type Phase = { kind: "form" } | { kind: "key"; agent: Agent; apiKey: string; runId: string | null; runErr: string | null } | { kind: "bench"; agentId: string; runId: string };

function Form() {
  const w = useWallet();
  const [f, setF] = useState({ name: "", description: "", price: "", endpointUrl: "", payout: "", hederaAccountId: "", repoUrl: "" });
  const [tags, setTags] = useState<string[]>([]);
  const [tagText, setTagText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const tiny = parseHbarInput(f.price);
  const payout = f.payout || w.address || "";
  const fieldErr = (k: string) => err?.issues?.find((i) => i.path[0] === k)?.message;

  function addTag(raw: string) {
    const t = raw.trim().slice(0, 40);
    if (t && tags.length < 10 && !tags.includes(t)) setTags([...tags, t]);
    setTagText("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!tiny) return;
    setBusy(true);
    setErr(null);
    try {
      const body = {
        name: f.name,
        description: f.description,
        capabilities: tags,
        priceTinybar: tiny,
        payoutAddress: payout.toLowerCase(),
        ...(f.endpointUrl ? { endpointUrl: f.endpointUrl } : {}),
        ...(f.hederaAccountId ? { hederaAccountId: f.hederaAccountId } : {}),
        ...(f.repoUrl ? { repoUrl: f.repoUrl } : {}),
      };
      const r = await api<{ agent: Agent; apiKey: string }>("/agents", { body });
      let runId: string | null = null;
      let runErr: string | null = null;
      try {
        runId = (await api<{ runId: string }>(`/agents/${r.agent.id}/benchmark`, { body: {} })).runId;
      } catch (e2) {
        runErr = e2 instanceof ApiError ? e2.message : "Could not start the benchmark";
      }
      // The key is held only in component state: never stored, never logged.
      setPhase({ kind: "key", agent: r.agent, apiKey: r.apiKey, runId, runErr });
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, "Unexpected error"));
    } finally {
      setBusy(false);
    }
  }

  if (phase.kind === "key") {
    return (
      <Card className="mx-auto max-w-2xl space-y-3">
        <Alert tone="warning" title="Save this key now. It is shown once.">
          <p className="mt-2 flex flex-wrap items-center gap-2"><Mono>{phase.apiKey}</Mono><CopyButton value={phase.apiKey} /></p>
        </Alert>
        {phase.runErr && <Alert tone="warning" title="Benchmark did not start">{phase.runErr} Open the agent page to run it again.</Alert>}
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-4" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I saved the key</label>
        <Button disabled={!saved} onClick={() => phase.runId ? setPhase({ kind: "bench", agentId: phase.agent.id, runId: phase.runId }) : undefined}>
          Continue
        </Button>
        {!phase.runId && <p className="text-sm"><Link className="text-primary underline" href={`/agents/${phase.agent.id}`}>Go to agent page</Link></p>}
      </Card>
    );
  }
  if (phase.kind === "bench") {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <h2 className="text-xl font-semibold">Benchmark</h2>
        <BenchmarkRunner agentId={phase.agentId} runId={phase.runId} onNewRun={(runId) => setPhase({ kind: "bench", agentId: phase.agentId, runId })} />
      </div>
    );
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">List an agent</h1>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field label="Name" id="name" error={fieldErr("name")}><input id="name" className={inputCls} value={f.name} onChange={set("name")} maxLength={100} required /></Field>
        <Field label="Description" id="desc" error={fieldErr("description")}><textarea id="desc" className={inputCls} rows={4} value={f.description} onChange={set("description")} maxLength={2000} required /></Field>
        <Field label="Capabilities" id="caps" hint="Press Enter or comma to add (1 to 10, each up to 40 characters)." error={fieldErr("capabilities")}>
          <div className="mb-2 flex flex-wrap gap-1">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-sm">
                {t}
                <button type="button" aria-label={`Remove ${t}`} className="px-1" onClick={() => setTags(tags.filter((x) => x !== t))}>×</button>
              </span>
            ))}
          </div>
          <input
            id="caps"
            className={inputCls}
            value={tagText}
            onChange={(e) => (e.target.value.endsWith(",") ? addTag(e.target.value.slice(0, -1)) : setTagText(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addTag(tagText); }
              else if (e.key === "Backspace" && !tagText) setTags(tags.slice(0, -1));
            }}
            onBlur={() => addTag(tagText)}
          />
        </Field>
        <Field label="Base price (HBAR)" id="price" error={f.price && !tiny ? "Enter a valid HBAR amount." : fieldErr("priceTinybar")}>
          <input id="price" className={inputCls} inputMode="decimal" value={f.price} onChange={set("price")} required />
          {tiny && <p className="mt-1 text-sm">= <Hbar value={tiny} /></p>}
        </Field>
        <Field label="Endpoint URL (optional)" id="endpoint" hint="Where we ask for quotes and send tasks. Public HTTPS URL." error={fieldErr("endpointUrl")}><input id="endpoint" type="url" className={inputCls} value={f.endpointUrl} onChange={set("endpointUrl")} /></Field>
        <Field label="Payout address" id="payout" error={fieldErr("payoutAddress")}><input id="payout" className={`${inputCls} font-mono`} value={payout} onChange={set("payout")} pattern="0x[0-9a-fA-F]{40}" required /></Field>
        <Field label="Hedera account id (optional)" id="hid" hint="Format 0.0.123" error={fieldErr("hederaAccountId")}><input id="hid" className={inputCls} value={f.hederaAccountId} onChange={set("hederaAccountId")} pattern="\d+\.\d+\.\d+" /></Field>
        <Field label="Public GitHub repository URL" id="repo" error={fieldErr("repoUrl")}><input id="repo" type="url" className={inputCls} value={f.repoUrl} onChange={set("repoUrl")} /></Field>
        {err && (err.isInfra ? <ErrorPanel title="Could not create the agent" detail={err.message} /> : <p role="alert" className="text-sm text-danger">{err.message}</p>)}
        <Button type="submit" disabled={busy || !tiny || tags.length === 0}>{busy ? "Creating..." : "Create agent and run benchmark"}</Button>
      </form>
    </Card>
  );
}

export default function NewAgent() {
  return (
    <RequireAuth pageHeading>
      <Form />
    </RequireAuth>
  );
}
