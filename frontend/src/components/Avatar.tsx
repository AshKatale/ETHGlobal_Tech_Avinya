import { colorFor, initials } from '@/lib/format';

export default function Avatar({ name, large }: { name: string; large?: boolean }) {
  const c = colorFor(name);
  return <div className={`av ${large ? 'lg' : ''}`} style={{ background: `linear-gradient(135deg,${c},${c}cc)` }} aria-hidden="true">{initials(name)}</div>;
}
