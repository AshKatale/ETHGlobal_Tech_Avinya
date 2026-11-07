'use client';
import { useEffect } from 'react';

/**
 * Scroll reveals for the landing page. Content stays visible until this runs (so no JavaScript means no hidden content);
 * then each [data-reveal] element is shown the first time it enters the viewport. Everything it changes is undone on leave.
 */
export default function ScrollFX() {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    let io: IntersectionObserver | undefined;
    if (!reduced && 'IntersectionObserver' in window) {
      root.classList.add('fx');
      // A fully clipped element (the wipe reveal) counts as not visible to the browser, so it could never trigger itself.
      // Wipe items are therefore revealed when their parent section comes into view.
      const watch = new Map<Element, HTMLElement[]>();
      for (const el of items) {
        const target = el.dataset.reveal === 'wipe' && el.parentElement ? el.parentElement : el;
        watch.set(target, [...(watch.get(target) ?? []), el]);
      }
      io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (watch.get(e.target) ?? []).forEach((el) => el.classList.add('in'));
          io?.unobserve(e.target);
        }
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
      watch.forEach((_, t) => io!.observe(t));
    }
    // The header gets a clearer edge once the page has scrolled (landing page only: this component is not mounted elsewhere).
    const header = document.querySelector('.gv-header');
    const onScroll = () => header?.classList.toggle('scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      io?.disconnect();
      window.removeEventListener('scroll', onScroll);
      header?.classList.remove('scrolled');
      root.classList.remove('fx');
    };
  }, []);
  return null;
}
