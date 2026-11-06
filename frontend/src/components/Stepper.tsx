export default function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="stepper">
      {steps.map((t, i) => (
        <div key={t} className={`step-pill ${i === current ? 'on' : i < current ? 'done' : ''}`}><i>{i < current ? '✓' : i + 1}</i>{t}</div>
      ))}
    </div>
  );
}
