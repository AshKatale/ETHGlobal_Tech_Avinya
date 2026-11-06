'use client';
import { useState } from 'react';
import { Icon } from './Icon';

export default function CopyBox({ value, label, mask }: { value: string; label?: string; mask?: boolean }) {
  const [done, setDone] = useState(false);
  const [show, setShow] = useState(!mask);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1800); } catch { /* clipboard blocked */ }
  };
  return (
    <div>
      {label && <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>{label}</div>}
      <div className="copy-box">
        <span style={{ minWidth: 0 }}>{show ? value : '•'.repeat(Math.min(value.length, 36))}</span>
        <span className="row" style={{ gap: 6, flex: 'none' }}>
          {mask && <button className="btn btn-ghost btn-sm" onClick={() => setShow((v) => !v)}>{show ? 'Hide' : 'Show'}</button>}
          <button className="btn btn-ghost btn-sm" onClick={copy}><Icon name="copy" size={15} />{done ? 'Copied' : 'Copy'}</button>
        </span>
      </div>
    </div>
  );
}
