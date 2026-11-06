'use client';
import { useEffect, type ReactNode } from 'react';

export default function Modal({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="gvm-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gvm" role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </div>
  );
}
