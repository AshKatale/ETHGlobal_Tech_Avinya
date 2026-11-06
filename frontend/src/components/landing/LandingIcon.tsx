import type { ReactElement } from 'react';

// Larger line icons used only on the landing page (the app's own Icon set is for small UI marks).
const P = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.6 } as const;
const ICONS: Record<string, ReactElement> = {
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" {...P} /><path {...P} d="M8 10.5V7.8a4 4 0 018 0v2.7M12 14.5v2.5" /></>,
  checks: <><path {...P} d="M4 7h9M4 12h6M4 17h9" /><path {...P} d="M15 14.5l2.5 2.5 4-5" /></>,
  shield: <><path {...P} d="M12 3l7.5 3v5.5c0 4.5-3 8-7.5 9.5-4.5-1.5-7.5-5-7.5-9.5V6z" /><path {...P} d="M9 12l2.2 2.2L15.5 10" /></>,
  proof: <><path {...P} d="M3 12s3.5-6.5 9-6.5S21 12 21 12s-3.5 6.5-9 6.5S3 12 3 12z" /><circle cx="12" cy="12" r="2.8" {...P} /></>,
  post: <><rect x="4" y="3.5" width="16" height="17" rx="2.5" {...P} /><path {...P} d="M8 9h8M8 13h8M8 17h4" /></>,
  quotes: <><path {...P} d="M4 5h12a2 2 0 012 2v6a2 2 0 01-2 2H9l-4 3.5V15H4a1 1 0 01-1-1V6a1 1 0 011-1z" /><path {...P} d="M20.5 9.5V16a2 2 0 01-2 2H17" /></>,
  fund: <><ellipse cx="12" cy="7" rx="7" ry="3" {...P} /><path {...P} d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></>,
  verify: <><circle cx="12" cy="12" r="8.5" {...P} /><path {...P} d="M8.5 12.2l2.4 2.4 4.6-5" /></>,
  paid: <><circle cx="12" cy="12" r="8.5" {...P} /><path {...P} d="M12 7.5v9M14.6 9.6c-.5-.8-1.5-1.2-2.6-1.2-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.1 0-2.1-.4-2.6-1.2" /></>,
  refund: <><path {...P} d="M4 12a8 8 0 108-8H7" /><path {...P} d="M10 1.5L6.5 4.5 10 7.5" /></>,
  pause: <><circle cx="12" cy="12" r="8.5" {...P} /><path {...P} d="M10 9v6M14 9v6" /></>,
  agent: <><rect x="5" y="8" width="14" height="11" rx="3" {...P} /><path {...P} d="M12 8V4.5M9.5 13h.01M14.5 13h.01M9.5 16.5h5" /><circle cx="12" cy="3.7" r="1" {...P} /></>,
  repo: <><path {...P} d="M7 4.5h8.5A1.5 1.5 0 0117 6v12.5H8.5A1.5 1.5 0 017 17z" /><path {...P} d="M7 17a1.8 1.8 0 011.8-1.8H17M10 8.5h4" /></>,
  key: <><circle cx="8" cy="12" r="3.5" {...P} /><path {...P} d="M11.5 12H20M17 12v3M20 12v2" /></>,
  link: <path {...P} d="M5 12h14M14 7l5 5-5 5" />,
  tick: <path {...P} strokeWidth="2" d="M5 12.5l4.5 4.5L19 7.5" />,
};

export default function LandingIcon({ name, big }: { name: string; big?: boolean }) {
  return <span className={`lp-ico ${big ? 'big' : ''}`} aria-hidden="true"><svg viewBox="0 0 24 24">{ICONS[name]}</svg></span>;
}
