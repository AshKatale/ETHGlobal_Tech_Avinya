'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useSignMessage } from 'wagmi';
import { api, apiErrorText } from '@/lib/api';
import { errMessage, shortAddr } from '@/lib/format';
import { useGithubStatus, useMe } from '@/lib/queries';
import type { Me } from '@/lib/types';
import { useSession } from '@/providers/Session';
import { useToast } from '@/providers/Toasts';
import Notice, { Empty } from '@/components/Notice';
import Field, { PasswordInput } from '@/components/Field';
import { Icon } from '@/components/Icon';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strong = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const PW_RULE = 'Use at least 8 characters, with a letter and a number.';
const ROLES: [Me['role'] & string, string][] = [['both', 'Hire and list agents'], ['client', 'Hire agents'], ['lister', 'List agents']];

/** Move keyboard focus to the first field that failed. */
const focusFirst = (ids: (string | false | undefined)[]) => document.getElementById(ids.find(Boolean) as string)?.focus();

export default function AccountPage() {
  const session = useSession();
  const me = useMe();
  const gh = useGithubStatus();
  const qc = useQueryClient();

  if (!session.ready) return <div className="page"><div className="container"><div className="skel" style={{ height: 300 }} /></div></div>;
  if (!session.signedIn) return (
    <div className="page"><div className="container" style={{ maxWidth: 720 }}>
      <Empty title="Log in to see your account"><button className="btn btn-primary" onClick={session.openConnect}><Icon name="lock" />Log in or sign up</button></Empty>
    </div></div>
  );
  const u = me.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['me'] });

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        <div className="page-head"><div><p className="eyebrow-p">Account</p><h1>{u?.displayName ?? 'Your account'}</h1><p>{u?.email ?? 'No email yet'} · {shortAddr(session.address)}</p></div>
          <div className="row wrap" style={{ gap: 10 }}><Link className="btn btn-outline" href="/dashboard?tab=agents">My agents</Link><Link className="btn btn-outline" href="/dashboard?tab=agent-jobs">Jobs on my agents</Link></div></div>
        {me.error && <Notice kind="bad" style={{ marginBottom: 20 }}>Could not load your account. {(me.error as Error).message} <button className="link" onClick={() => me.refetch()}>Try again</button></Notice>}
        {me.isLoading || !u ? <div className="skel" style={{ height: 320 }} /> : (
          <div className="stack">
            {!u.hasPassword && <Notice kind="warn"><b>Your account is protected by your wallet only.</b> Add an email and password below to require both at login.</Notice>}
            <Profile u={u} onSaved={refresh} />
            {u.hasPassword ? <ChangePassword /> : <AddPassword onDone={refresh} />}
            <div className="card">
              <h3>Connections</h3>
              <dl className="kv">
                <dt>Wallet</dt><dd className="mono" style={{ fontSize: 12.5 }}>{u.address}</dd>
                <dt>GitHub</dt><dd>{gh.isLoading ? '…' : gh.data?.connected ? `Connected as @${gh.data.login}` : 'Not connected. You can connect it when you list an agent.'}</dd>
                <dt>Member since</dt><dd>{new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
              </dl>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Profile({ u, onSaved }: { u: Me; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(u.displayName ?? '');
  const [role, setRole] = useState<Me['role']>(u.role ?? 'both');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  useEffect(() => { setName(u.displayName ?? ''); setRole(u.role ?? 'both'); }, [u.displayName, u.role]);
  async function save() {
    if (!name.trim()) { setErr('Enter a display name.'); focusFirst(['acc-name']); return; }
    setErr(undefined);
    setBusy(true);
    try { await api('/me', { method: 'PATCH', auth: true, body: { displayName: name.trim(), role } }); onSaved(); toast('Profile saved', ''); }
    catch (e) { toast('Could not save', apiErrorText(e), 'bad'); }
    setBusy(false);
  }
  return (
    <div className="card"><h3>Profile</h3><div className="form-grid">
      <div className="form-grid two">
        <Field label="Display name" error={err}><input id="acc-name" className="input" maxLength={60} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="What you do here"><select className="select" value={role ?? 'both'} onChange={(e) => setRole(e.target.value as Me['role'])}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      <div><button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button></div>
    </div></div>
  );
}

function AddPassword({ onDone }: { onDone: () => void }) {
  const session = useSession();
  const { toast } = useToast();
  const { signMessageAsync } = useSignMessage();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Partial<Record<'email' | 'pw' | 'pw2' | 'form', string>>>({});

  async function submit() {
    const e: typeof errs = {};
    if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address, like name@example.com.';
    if (!strong(pw)) e.pw = PW_RULE;
    if (pw !== pw2) e.pw2 = 'The two passwords do not match.';
    setErrs(e);
    if (e.email || e.pw || e.pw2) { focusFirst([e.email && 'acc-email', e.pw && 'acc-pw', e.pw2 && 'acc-pw2']); return; }
    setBusy(true);
    try {
      // Proving the wallet again with a fresh signature is what authorises adding the password.
      const { nonce, message } = await api<{ nonce: string; message: string }>('/auth/nonce', { body: { address: session.address } });
      const signature = await signMessageAsync({ message });
      await api('/auth/signup', { body: { address: session.address, nonce, signature, email: email.trim(), password: pw } });
      toast('Email and password added', 'Next logins need your wallet and this password.');
      setPw(''); setPw2(''); onDone();
    } catch (er) { setErrs({ form: apiErrorText(er) === 'Something went wrong.' ? errMessage(er) : apiErrorText(er) }); }
    setBusy(false);
  }
  return (
    <div className="card"><h3>Add email and password</h3><div className="form-grid">
      <Field label="Email" error={errs.email}><input id="acc-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <div className="form-grid two">
        <Field label="Password" hint="At least 8 characters, with a letter and a number." error={errs.pw}><PasswordInput id="acc-pw" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Confirm password" error={errs.pw2}><PasswordInput id="acc-pw2" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
      </div>
      {errs.form && <div className="form-summary" role="alert">{errs.form}</div>}
      <div className="row wrap" style={{ gap: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy || !session.walletReady}>{busy ? 'Confirm in your wallet…' : 'Add email and password'}</button>
        {!session.walletReady && <span className="hint">Connect the wallet you signed in with first.</span>}
      </div>
    </div></div>
  );
}

function ChangePassword() {
  const { toast } = useToast();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Partial<Record<'cur' | 'pw' | 'pw2' | 'form', string>>>({});

  async function submit() {
    const e: typeof errs = {};
    if (!cur) e.cur = 'Enter your current password.';
    if (!strong(pw)) e.pw = PW_RULE;
    if (pw !== pw2) e.pw2 = 'The two new passwords do not match.';
    setErrs(e);
    if (e.cur || e.pw || e.pw2) { focusFirst([e.cur && 'acc-cur', e.pw && 'acc-npw', e.pw2 && 'acc-npw2']); return; }
    setBusy(true);
    try {
      await api('/me/password', { auth: true, body: { currentPassword: cur, newPassword: pw } });
      toast('Password changed', 'Your other devices were signed out.');
      setCur(''); setPw(''); setPw2('');
    } catch (er) { setErrs({ form: apiErrorText(er) }); }
    setBusy(false);
  }
  return (
    <div className="card"><h3>Password</h3><div className="form-grid">
      <Field label="Current password" error={errs.cur}><PasswordInput id="acc-cur" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <div className="form-grid two">
        <Field label="New password" hint="At least 8 characters, with a letter and a number." error={errs.pw}><PasswordInput id="acc-npw" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Confirm new password" error={errs.pw2}><PasswordInput id="acc-npw2" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
      </div>
      {errs.form && <div className="form-summary" role="alert">{errs.form}</div>}
      <div><button className="btn btn-outline btn-sm" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
    </div></div>
  );
}
