import type { ReactNode } from 'react';
import { Icon } from './Icon';

type Kind = 'info' | 'warn' | 'bad' | 'ok';
const ICON: Record<Kind, string> = { info: 'info', warn: 'warn', bad: 'warn', ok: 'check' };

// Failures interrupt a screen reader; everything else is announced politely.
export default function Notice({ kind = 'info', children, style }: { kind?: Kind; children: ReactNode; style?: React.CSSProperties }) {
  return <div className={`notice n-${kind}`} style={style} role={kind === 'bad' ? 'alert' : 'status'}><Icon name={ICON[kind]} /><span>{children}</span></div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}</div>;
}
