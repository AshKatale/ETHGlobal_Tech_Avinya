'use client';
import { useEffect, useRef, useState } from 'react';

/** Counts up to a real value when it scrolls into view. Screen readers get the final number, never the in-between digits. */
export default function CountUp({ value, duration = 1385 }: { value: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(value); return; }
    let raf = 0;
    const run = () => {
      const start = performance.now();
      const a = from.current;
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        const v = Math.round(a + (value - a) * eased);
        from.current = v;
        setN(v);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); run(); } }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value, duration]);

  return <><span ref={ref} aria-hidden="true" style={{ fontVariantNumeric: 'tabular-nums' }}>{n}</span><span className="sr">{value}</span></>;
}
