// Decorative: the score is always printed as text next to the bar, so screen readers skip it.
export default function Meter({ value, bad }: { value: number; bad?: boolean }) {
  return <div className={`meter ${bad ? 'bad' : ''}`} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}
