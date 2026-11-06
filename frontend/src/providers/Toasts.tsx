'use client';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Kind = '' | 'bad' | 'info';
type T = { id: number; msg: string; sub?: string; kind: Kind };
type Ctx = { toast: (msg: string, sub?: string, kind?: Kind) => void };

const ToastCtx = createContext<Ctx>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const toast = useCallback((msg: string, sub?: string, kind: Kind = '') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, msg, sub, kind }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4800);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="gv-toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`gv-toast ${t.kind}`}>
            <div>{t.msg}{t.sub ? <small>{t.sub}</small> : null}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
