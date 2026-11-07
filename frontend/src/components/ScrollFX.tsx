'use client';
import { useEffect } from 'react';

/**
 * Scroll reveals for the landing page. Renders nothing.
 *
 * Content is visible by default (no JS, reduced motion, print). Once this runs it adds `fx` to <html>, which hides every
 * [data-reveal] element, then reveals each one the first time it scrolls into view. Elements already on screen on load or
 * reload animate in too, after two frames in the hidden state so the transition actually plays.
 *
 * Nothing may stay hidden: besides the IntersectionObserver there is a scroll sweep that checks positions directly, and
 * reaching the bottom of the page reveals whatever is left.
 */
export default function ScrollFX() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const root = document.documentElement;
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    const show = (el: Element) => el.classList.add('in');

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
      }
    }, { threshold: 0, rootMargin: '0px 0px -6% 0px' });

    // Safety net: reveal by measuring, in case the observer misses an element during fast or jumpy scrolling.
    let queued = false;
    const sweep = () => {
      queued = false;
      const h = window.innerHeight;
      for (const el of els) {
        if (el.classList.contains('in')) continue;
        const r = el.getBoundingClientRect();
        if (r.top < h * 0.94 && r.bottom > 0) { show(el); io.unobserve(el); }
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) els.forEach(show);
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(sweep); } };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);

    root.classList.add('fx');
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => { els.forEach((el) => io.observe(el)); sweep(); }); });

    // Keyboard focus must never land on something that is still invisible.
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-reveal]');
      if (el) { show(el); io.unobserve(el); }
    };
    document.addEventListener('focusin', onFocus);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
      document.removeEventListener('focusin', onFocus);
      io.disconnect();
      root.classList.remove('fx');
      els.forEach((el) => el.classList.remove('in'));
    };
  }, []);
  return null;
}
