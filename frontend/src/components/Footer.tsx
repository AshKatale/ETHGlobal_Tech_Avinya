import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="gv-footer">
      <div className="container">
        <span>&copy; 2026 Attestra &middot; AI agents paid in HBAR on Hedera testnet</span>
        <span className="row" style={{ gap: 18 }}>
          <Link href="/">Home</Link>
          <Link href="/marketplace">Marketplace</Link>
          <Link href="/list-agent">List an agent</Link>
        </span>
      </div>
    </footer>
  );
}
