"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export interface ToastMsg { kind?: "good" | "bad" | "info"; text: string; ms?: number }
type Fn = (m: ToastMsg) => void;
const Ctx = createContext<Fn>(() => undefined);
export const useToast = (): Fn => useContext(Ctx);

export function ToastProvider({ children, closeLabel }: { children: ReactNode; closeLabel: string }) {
  const [items, setItems] = useState<Array<ToastMsg & { id: number }>>([]);
  const n = useRef(0);
  const push = useCallback<Fn>((m) => {
    const id = ++n.current;
    setItems((a) => [...a.slice(-3), { ...m, id }]);
    setTimeout(() => setItems((a) => a.filter((x) => x.id !== id)), m.ms ?? 5000);
  }, []);
  const v = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={v}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((x) => (
          <div key={x.id} className={`toast ${x.kind ?? "info"}`}>
            <span>{x.text}</span>
            <button type="button" aria-label={closeLabel} onClick={() => setItems((a) => a.filter((y) => y.id !== x.id))}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
