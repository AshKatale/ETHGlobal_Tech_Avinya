'use client';
import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from 'react';

type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean };

/**
 * One label, one control, an optional hint and an error, wired together for screen readers.
 * Pass a single <input>, <select> or <textarea> as the child.
 */
export default function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactElement<ControlProps> }) {
  const uid = useId();
  const id = (isValidElement(children) && children.props.id) || `f${uid}`;
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && <span className="hint" id={hintId}>{hint}</span>}
      {error && <span className="err" id={errId}>{error}</span>}
    </div>
  );
}

/** A password input with a Show / Hide button. */
export function PasswordInput({ id, className = 'input', ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input id={id} className={className} type={show ? 'text' : 'password'} {...rest} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
    </div>
  );
}
