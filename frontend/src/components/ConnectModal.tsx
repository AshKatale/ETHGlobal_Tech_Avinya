'use client';
import Modal from './Modal';
import { FoxIcon, HbarIcon, Icon, WcIcon } from './Icon';
import { useSession, type StepKey } from '@/providers/Session';

const LABELS: Record<StepKey, string> = {
  connect: 'Connect your wallet account',
  network: 'Switch to Hedera Testnet (chain 296)',
  sign: 'Sign in with a one-time message',
};

export default function ConnectModal() {
  const s = useSession();
  if (!s.modalOpen) return null;
  const started = Object.values(s.steps).some((v) => v !== 'wait');
  return (
    <Modal onClose={s.closeConnect} label="Connect a wallet">
      <h2>Connect a wallet <button onClick={s.closeConnect} aria-label="Close">&times;</button></h2>
      <p className="sub">Gigiverse runs on Hedera testnet. Use an EVM wallet with an <b>ECDSA</b> Hedera account.</p>

      {!started ? (
        <>
          <button className="gvm-opt" onClick={s.signIn} disabled={s.busy}>
            <FoxIcon /><span>MetaMask<small>Via the Hedera JSON-RPC relay</small></span><em>Recommended</em>
          </button>
          <button className="gvm-opt" disabled><WcIcon /><span>WalletConnect<small>Coming later</small></span><em>Soon</em></button>
          <button className="gvm-opt" disabled><HbarIcon /><span>HashPack<small>Coming later</small></span><em>Soon</em></button>
          {!s.hasWallet && (
            <div className="gvm-err">No browser wallet detected. <a className="link" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">Install MetaMask</a>, then reload.</div>
          )}
          <p className="gvm-note">Signing in does not send a transaction and costs nothing.</p>
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
              {s.error && <button className="gvm-btn p" onClick={s.signIn}>Try again</button>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
