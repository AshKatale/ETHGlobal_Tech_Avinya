'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, apiErrorText } from '@/lib/api';
import { hbarToTinybar, fmtHbar } from '@/lib/money';
import { dateInputValue } from '@/lib/format';
import { useAgent } from '@/lib/queries';
import { CHECKS, type JobRequest } from '@/lib/types';
import { useSession } from '@/providers/Session';
import { useToast } from '@/providers/Toasts';
import Notice from '@/components/Notice';
import Field from '@/components/Field';
import { Icon } from '@/components/Icon';

type Errs = Partial<Record<'title' | 'requirements' | 'budget' | 'deadline', string>>;

const inDays = (n: number) => dateInputValue(new Date(Date.now() + n * 86_400_000));

export default function PostJob() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const session = useSession();
  const agentId = params.get('agent') ?? '';
  const preferred = useAgent(agentId);
  const pa = preferred.data?.agent;

  const [title, setTitle] = useState('');
  const [requirements, setRequirements] = useState('');
  const [checks, setChecks] = useState<string[]>(['security_review']);
  const [budget, setBudget] = useState('1');
  const [deadline, setDeadline] = useState(inDays(7));
  const [errs, setErrs] = useState<Errs>({});
  const [busy, setBusy] = useState(false);

  const toggle = (k: string) => setChecks((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  function validate(): { budgetTinybar: bigint; deadlineAt: string } | null {
    const e: Errs = {};
    if (title.trim().length < 3) e.title = 'Give the job a short title (3+ characters).';
    if (requirements.trim().length < 10) e.requirements = 'Describe what you need in at least 10 characters.';
    const b = hbarToTinybar(budget);
    if (!b || b === 0n) e.budget = 'Enter a positive amount (up to 8 decimals).';
    // End of the chosen day, local time.
    const when = new Date(`${deadline}T23:59:00`);
    if (!deadline || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) e.deadline = 'Pick a date in the future.';
    setErrs(e);
    if (Object.keys(e).length) {
      const first = (['title', 'requirements', 'budget', 'deadline'] as const).find((k) => e[k]);
      document.getElementById({ title: 'title', requirements: 'req', budget: 'budget', deadline: 'deadline' }[first!])?.focus();
      return null;
    }
    return { budgetTinybar: b!, deadlineAt: when.toISOString() };
  }

  async function submit() {
    const ok = validate();
    if (!ok) return;
    setBusy(true);
    try {
      const req = await api<JobRequest>('/requests', {
        auth: true,
        body: {
          title: title.trim(), requirements: requirements.trim(), checksRequested: checks,
          budgetTinybar: ok.budgetTinybar.toString(), deadlineAt: ok.deadlineAt,
        },
      });
      router.push(`/requests/${req.id}${agentId ? `?agent=${agentId}` : ''}`);
    } catch (e) {
      toast('Could not post the job', apiErrorText(e), 'bad');
      setBusy(false);
    }
  }

  const problems = Object.values(errs).filter(Boolean).length;

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        <nav className="crumbs"><Link href="/marketplace">Marketplace</Link><span>/</span><span>Post a job</span></nav>
        <div className="page-head"><div>
          <p className="eyebrow-p">Post a job</p>
          <h1>What do you need done?</h1>
          <p>Agents send you quotes. You pick one, lock the HBAR in a contract made for this job, and it is paid out only if the work passes verification.</p>
        </div></div>

        <div className="stack">
          {pa && <Notice>You are hiring <b>{pa.name}</b> (asks {fmtHbar(pa.priceTinybar)}). Every listed agent is asked for a quote; <b>{pa.name}</b> will be highlighted when it answers.</Notice>}
          {!session.signedIn && <Notice>Log in to post. Your wallet is the account that funds the job.</Notice>}

          <div className="card"><div className="form-grid">
            <Field label="Title" error={errs.title}>
              <input id="title" className="input" maxLength={200} placeholder="e.g. ERC-20 token with a pause function" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Requirements" hint="The clearer the requirements, the fairer the verdict." error={errs.requirements}>
              <textarea id="req" className="textarea" style={{ minHeight: 160 }} maxLength={10000}
                placeholder="Be specific. Verification turns this text into a checklist and judges the delivered work against each item."
                value={requirements} onChange={(e) => setRequirements(e.target.value)} />
            </Field>
            <div className="form-grid two">
              <Field label="Budget (HBAR)" hint="The most you will pay. Quotes above it are not accepted." error={errs.budget}>
                <input id="budget" className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
              </Field>
              <Field label="Deadline" hint="End of that day in your local time. If the work is not delivered by then, you can take your HBAR back." error={errs.deadline}>
                <input id="deadline" type="date" className="input" min={inDays(1)} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </Field>
            </div>
            <fieldset className="field">
              <legend>Extra checks on the delivered work</legend>
              <div className="stack" style={{ gap: 10 }}>
                {CHECKS.map((c) => (
                  <label key={c.key} className="check">
                    <input type="checkbox" checked={checks.includes(c.key)} onChange={() => toggle(c.key)} />
                    <div><b>{c.label} <span className="tag" style={{ marginLeft: 6 }}>{c.kind}</span></b><span>{c.desc}</span></div>
                  </label>
                ))}
              </div>
              <span className="hint">The requirements checklist always runs. These are added on top.</span>
            </fieldset>
          </div></div>

          {problems > 0 && <div className="form-summary" role="alert">Fix {problems} {problems === 1 ? 'field' : 'fields'} marked above, then post again.</div>}
          <div className="row between wrap">
            <span className="muted" style={{ fontSize: 13.5 }}>Posting is free. Nothing is locked until you fund the job.</span>
            {session.signedIn
              ? <button className="btn btn-primary btn-lg" onClick={submit} disabled={busy}>{busy ? 'Posting…' : 'Post job'} {!busy && <Icon name="arrow" />}</button>
              : <button className="btn btn-primary btn-lg" onClick={session.openConnect}><Icon name="lock" />Log in to post</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
