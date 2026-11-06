export default function Meter({ value, bad }: { value: number; bad?: boolean }) {
  return <div className={`meter ${bad ? 'bad' : ''}`}><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}
