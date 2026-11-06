'use client';
import { useState } from 'react';
import Modal from './Modal';
import { FoxIcon, Icon } from './Icon';
import { useSession, type AuthIntent, type StepKey } from '@/providers/Session';

const LABELS: Record<StepKey, string> = {
  connect: 'Connect your wallet account',
  network: 'Switch to Hedera Testnet (chain 296)',
  sign: 'Sign in with a one-time message',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const field = { width: '100%', marginBottom: 10 } as const;

export default function ConnectModal() {
  const s = useSession();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'client' | 'lister' | 'both'>('both');
  const [problem, setProblem] = useState<string>();
  const [last, setLast] = useState<AuthIntent>({ mode: 'login' });
  if (!s.modalOpen) return null;
  const started = Object.values(s.steps).some((v) => v !== 'wait');

  function go() {
    setProblem(undefined);
    let intent: AuthIntent;
    if (mode === 'signup') {
      if (!EMAIL_RE.test(email.trim())) return setProblem('Enter a valid email address.');
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return setProblem('Password: at least 8 characters with a letter and a number.');
      if (password !== confirm) return setProblem('The two passwords do not match.');
      intent = { mode, email: email.trim(), password, displayName: name.trim() || undefined, role };
    } else {
      intent = { mode, password: password || undefined };
    }
    setLast(intent);
    void s.signIn(intent);
  }

  return (
    <Modal onClose={s.closeConnect} label="Log in or sign up">
      <h2>{mode === 'signup' ? 'Create your account' : 'Log in'} <button onClick={s.closeConnect} aria-label="Close">&times;</button></h2>
      <p className="sub">Gigiverse runs on Hedera testnet. Your account is your <b>ECDSA</b> wallet{mode === 'signup' ? ', protected by an email and password' : ', plus your password if you set one'}.</p>

      {!started ? (
        <>
          <div className="gvm-acts" style={{ marginBottom: 14 }}>
            <button className={`gvm-btn ${mode === 'login' ? 'p' : ''}`} onClick={() => { setMode('login'); setProblem(undefined); }}>Log in</button>
            <button className={`gvm-btn ${mode === 'signup' ? 'p' : ''}`} onClick={() => { setMode('signup'); setProblem(undefined); }}>Sign up</button>
          </div>

          {mode === 'signup' && (
            <>
              <input className="input" style={field} type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input className="input" style={field} placeholder="Display name (optional)" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </>
          )}
          <input className="input" style={field} type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder={mode === 'signup' ? 'Password (8+ characters, a letter and a number)' : 'Password (only if you set one)'}
            value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
          {mode === 'signup' && (
            <>
              <input className="input" style={field} type="password" autoComplete="new-password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <select className="select" style={field} value={role} onChange={(e) => setRole(e.target.value as typeof role)} aria-label="What will you do here">
                <option value="both">I will hire agents and list agents</option>
                <option value="client">I will hire agents</option>
                <option value="lister">I will list agents</option>
              </select>
            </>
          )}
          {problem && <div className="gvm-err">{problem}</div>}

          <button className="gvm-opt" onClick={go} disabled={s.busy || !s.hasWallet}>
            <FoxIcon /><span>{mode === 'signup' ? 'Sign up with MetaMask' : 'Log in with MetaMask'}<small>Via the Hedera JSON-RPC relay</small></span><em>Recommended</em>
          </button>
          {!s.hasWallet && (
            <div className="gvm-err">No browser wallet detected. <a className="link" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">Install MetaMask</a>, then reload.</div>
          )}
          <p className="gvm-note">{mode === 'signup' ? 'Your wallet signs one message. No transaction, no cost. Later logins need the wallet and this password.' : 'Signing in does not send a transaction and costs nothing. New here? Choose Sign up.'}</p>
        </>
      ) : (
        <>
          <div className="gvm-steps">
            {(Object.keys(LABELS) as StepKey[]).map((k) => (
              <div key={k} className={`gvm-step ${s.steps[k] === 'wait' ? '' : s.steps[k]}`}>
                <i>{s.steps[k] === 'ok' ? <Icon name="check" /> : s.steps[k] === 'bad' ? <Icon name="x" /> : null}</i>{LABELS[k]}
              </div>
            ))}
          </div>
          {s.error && <div className="gvm-err">{s.error}</div>}
          {s.busy ? <p className="gvm-note">Approve each request in your wallet.</p> : (
            <div className="gvm-acts">
              <button className="gvm-btn" onClick={s.closeConnect}>Close</button>
              {s.error && <button className="gvm-btn" onClick={s.resetSteps}>Back</button>}
              {s.error && <button className="gvm-btn p" onClick={() => void s.signIn(last)}>Try again</button>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
