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
import { Icon } from '@/components/Icon';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strong = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const ROLES: [Me['role'] & string, string][] = [['both', 'Hire and list agents'], ['client', 'Hire agents'], ['lister', 'List agents']];

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
          <div className="row" style={{ gap: 10 }}><Link className="btn btn-outline" href="/dashboard?tab=agents">My agents</Link><Link className="btn btn-outline" href="/dashboard?tab=agent-jobs">Jobs on my agents</Link></div></div>
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
  useEffect(() => { setName(u.displayName ?? ''); setRole(u.role ?? 'both'); }, [u.displayName, u.role]);
  async function save() {
    if (!name.trim()) return toast('Enter a display name', '', 'bad');
    setBusy(true);
    try { await api('/me', { method: 'PATCH', auth: true, body: { displayName: name.trim(), role } }); onSaved(); toast('Profile saved', ''); }
    catch (e) { toast('Could not save', apiErrorText(e), 'bad'); }
    setBusy(false);
  }
  return (
    <div className="card"><h3>Profile</h3><div className="form-grid">
      <div className="form-grid two">
        <div className="field"><label htmlFor="dn">Display name</label><input id="dn" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="rl">What you do here</label><select id="rl" className="select" value={role ?? 'both'} onChange={(e) => setRole(e.target.value as Me['role'])}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
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
  const [err, setErr] = useState<string>();

  async function submit() {
    setErr(undefined);
    if (!EMAIL_RE.test(email.trim())) return setErr('Enter a valid email address.');
    if (!strong(pw)) return setErr('Password: at least 8 characters with a letter and a number.');
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setBusy(true);
    try {
      // Proving the wallet again with a fresh signature is what authorises adding the password.
      const { nonce, message } = await api<{ nonce: string; message: string }>('/auth/nonce', { body: { address: session.address } });
      const signature = await signMessageAsync({ message });
      await api('/auth/signup', { body: { address: session.address, nonce, signature, email: email.trim(), password: pw } });
      toast('Email and password added', 'Next logins need your wallet and this password.');
      setPw(''); setPw2(''); onDone();
    } catch (e) { setErr(apiErrorText(e) === 'Something went wrong.' ? errMessage(e) : apiErrorText(e)); }
    setBusy(false);
  }
  return (
    <div className="card"><h3>Add email and password</h3><div className="form-grid">
      <div className="field"><label htmlFor="em">Email</label><input id="em" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="form-grid two">
        <div className="field"><label htmlFor="p1">Password</label><input id="p1" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <div className="field"><label htmlFor="p2">Confirm password</label><input id="p2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
      </div>
      {err && <span className="err">{err}</span>}
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
  const [err, setErr] = useState<string>();

  async function submit() {
    setErr(undefined);
    if (!cur) return setErr('Enter your current password.');
    if (!strong(pw)) return setErr('New password: at least 8 characters with a letter and a number.');
    if (pw !== pw2) return setErr('The two new passwords do not match.');
    setBusy(true);
    try {
      await api('/me/password', { auth: true, body: { currentPassword: cur, newPassword: pw } });
      toast('Password changed', 'Your other devices were signed out.');
      setCur(''); setPw(''); setPw2('');
    } catch (e) { setErr(apiErrorText(e)); }
    setBusy(false);
  }
  return (
    <div className="card"><h3>Password</h3><div className="form-grid">
      <div className="field"><label htmlFor="cp">Current password</label><input id="cp" className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
      <div className="form-grid two">
        <div className="field"><label htmlFor="np">New password</label><input id="np" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <div className="field"><label htmlFor="np2">Confirm new password</label><input id="np2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
      </div>
      {err && <span className="err">{err}</span>}
      <div><button className="btn btn-outline btn-sm" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
    </div></div>
  );
}
