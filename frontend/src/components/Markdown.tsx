import { Fragment, type ReactNode } from 'react';

// A very small, safe renderer for the AI review text: headings, bullets, **bold** and `code`. No HTML is ever injected.
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**')) return <b key={i} style={{ color: '#fff' }}>{part.slice(2, -2)}</b>;
    if (part.startsWith('`')) return <code key={i} className="hash">{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export default function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (k: number) => {
    if (bullets.length) {
      blocks.push(<ul key={`u${k}`} style={{ margin: '4px 0 12px', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
      bullets = [];
    }
  };
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line) ?? /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet) { bullets.push(bullet[1]); return; }
    flush(i);
    if (!line) return;
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    if (h) blocks.push(<h4 key={i} style={{ fontSize: 15, fontWeight: 600, margin: '14px 0 6px' }}>{inline(h[1])}</h4>);
    else blocks.push(<p key={i} style={{ margin: '0 0 10px' }}>{inline(line)}</p>);
  });
  flush(-1);
  return <div style={{ color: 'var(--muted)', fontSize: 14.5, lineHeight: 1.6 }}>{blocks}</div>;
}
