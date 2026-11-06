'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBalance } from 'wagmi';
import { useSession } from '@/providers/Session';
import { fmtHbar, fromWeibar } from '@/lib/money';
import { shortAddr } from '@/lib/format';
import { FAUCET_URL } from '@/lib/config';
import Modal from './Modal';
import { Icon } from './Icon';

const NAV = [
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/post-job', label: 'Post a job' },
  { href: '/list-agent', label: 'List an agent' },
  { href: '/dashboard', label: 'Dashboard' },
];

function WalletChip({ onOpen }: { onOpen: () => void }) {
  const { address } = useSession();
  const bal = useBalance({ address, query: { enabled: !!address, refetchInterval: 20_000 } });
  return (
    <button className="wallet-chip" onClick={onOpen} title="Wallet">
      <span className="bal"><b>{bal.data ? fmtHbar(fromWeibar(bal.data.value)) : '…'}</b></span>
      <span className="addr">{shortAddr(address)}</span>
    </button>
  );
}

function WalletMenu({ onClose }: { onClose: () => void }) {
  const { address, signOut, wrongNetwork, switchNetwork } = useSession();
  const bal = useBalance({ address, query: { enabled: !!address } });
  return (
    <Modal onClose={onClose} label="Your wallet">
      <h2>Your wallet <button onClick={onClose} aria-label="Close">&times;</button></h2>
      <p className="sub">MetaMask &middot; Hedera testnet (chain 296)</p>
      <dl className="gvm-rows">
        <dt>Address</dt><dd className="mono" style={{ fontSize: 12.5 }}>{address}</dd>
        <dt>Balance</dt><dd>{bal.data ? fmtHbar(fromWeibar(bal.data.value)) : '…'}</dd>
      </dl>
      {wrongNetwork && (
        <div className="gvm-err">Your wallet is on another network. <button className="link" onClick={switchNetwork}>Switch to Hedera Testnet</button></div>
      )}
      <div className="gvm-acts">
        <Link className="gvm-btn" href="/dashboard" onClick={onClose}>Dashboard</Link>
        <Link className="gvm-btn" href="/account" onClick={onClose}>Account</Link>
        <button className="gvm-btn" onClick={() => { onClose(); signOut(); }}>Disconnect</button>
      </div>
      <a className="gvm-btn" style={{ width: '100%', marginTop: 10 }} href={FAUCET_URL} target="_blank" rel="noopener noreferrer">Get test HBAR (Hedera faucet)</a>
    </Modal>
  );
}

export default function Header() {
  const path = usePathname();
  const s = useSession();
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const active = (href: string) => path === href || path.startsWith(href + '/');
  return (
    <header className="gv-header">
      <div className="container gv-nav">
        <Link className="gv-logo" href="/" aria-label="Gigiverse home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gigiverse-logo.png" alt="Gigiverse" width={157} height={32} />
        </Link>
        <nav className="gv-links" aria-label="App">
          {NAV.map((n) => <Link key={n.href} href={n.href} className={active(n.href) ? 'active' : ''}>{n.label}</Link>)}
        </nav>
        <div className="gv-right">
          <span className="net-pill"><i />Hedera testnet</span>
          {s.ready && s.signedIn
            ? <WalletChip onOpen={() => setMenu(true)} />
            : <button className="btn btn-primary btn-sm" onClick={s.openConnect}><Icon name="lock" />Connect wallet</button>}
          <button className="burger" aria-label="Menu" onClick={() => setMobile((v) => !v)}><span /><span /><span /></button>
        </div>
      </div>
      <nav className={`mnav ${mobile ? 'open' : ''}`}>
        {NAV.map((n) => <Link key={n.href} href={n.href} className={active(n.href) ? 'active' : ''} onClick={() => setMobile(false)}>{n.label}</Link>)}
      </nav>
      {s.signedIn && s.wrongNetwork && (
        <div className="container" style={{ paddingTop: 10, paddingBottom: 10 }}>
          <div className="notice n-warn"><Icon name="warn" /><span><b>Wrong network.</b> Your wallet is not on Hedera Testnet. <button className="link" onClick={s.switchNetwork}>Switch network</button></span></div>
        </div>
      )}
      {menu && <WalletMenu onClose={() => setMenu(false)} />}
    </header>
  );
}
