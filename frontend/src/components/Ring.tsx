import { useId } from 'react';

export default function Ring({ score, stroke = 10, neutral = false }: { score: number; stroke?: number; neutral?: boolean }) {
  const gid = useId().replace(/:/g, '');
  const r = 50 - stroke / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="oklch(75.768% 0.125 198.173)" /><stop offset="1" stopColor="oklch(84.972% 0.12016 146.073)" /></linearGradient></defs>
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(255 255 255 / .1)" strokeWidth={stroke} />
      <circle cx="50" cy="50" r={r} fill="none" stroke={neutral || score >= 80 ? `url(#${gid})` : 'oklch(70% 0.17 25)'} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c.toFixed(1)} strokeDashoffset={off.toFixed(1)} />
    </svg>
  );
}
