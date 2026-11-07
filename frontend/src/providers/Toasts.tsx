'use client';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type Kind = '' | 'bad' | 'info';
type T = { id: number; msg: string; sub?: string; kind: Kind };
type Ctx = { toast: (msg: string, sub?: string, kind?: Kind) => void };

const ToastCtx = createContext<Ctx>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

const LIFETIME = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);
  const arm = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.set(id, setTimeout(() => dismiss(id), LIFETIME));
  }, [dismiss]);
  const hold = (id: number) => { clearTimeout(timers.current.get(id)); timers.current.delete(id); };

  const toast = useCallback((msg: string, sub?: string, kind: Kind = '') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, msg, sub, kind }]);
    // Errors carry the reason the user needs, so they stay until dismissed.
    if (kind !== 'bad') arm(id);
  }, [arm]);
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="gv-toasts">
        {items.map((t) => (
          <div
            key={t.id}
            className={`gv-toast ${t.kind}`}
            role={t.kind === 'bad' ? 'alert' : 'status'}
            onMouseEnter={() => hold(t.id)}
            onMouseLeave={() => { if (t.kind !== 'bad') arm(t.id); }}
            onFocus={() => hold(t.id)}
            onBlur={() => { if (t.kind !== 'bad') arm(t.id); }}
          >
            <div>{t.msg}{t.sub ? <small>{t.sub}</small> : null}</div>
            <button onClick={() => dismiss(t.id)} aria-label={`Dismiss: ${t.msg}`}>&times;</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
