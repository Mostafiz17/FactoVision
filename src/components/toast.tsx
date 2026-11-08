"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { cn } from "@/lib/utils";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: "success" | "error" | "info";
  action?: { label: string; onClick: () => void | Promise<void> };
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const ToastContext = createContext<{ push: (t: ToastOptions) => void }>({ push: () => undefined });

export function useToast() {
  return useContext(ToastContext);
}

const TONE: Record<string, { icon: IconName; cls: string }> = {
  success: { icon: "check", cls: "text-lime-300 bg-lime-400/15 border-lime-400/30" },
  error: { icon: "alert", cls: "text-rose-300 bg-rose-500/15 border-rose-500/30" },
  info: { icon: "info", cls: "text-cyan-300 bg-cyan-400/15 border-cyan-400/30" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (t: ToastOptions) => {
      const id = ++idRef.current;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), t.duration ?? (t.action ? 7000 : 4200)),
      );
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => {
          const tone = TONE[t.tone ?? "info"];
          return (
            <div key={t.id} className="pointer-events-auto animate-toast rounded-xl border border-line bg-ink-800/95 p-3 shadow-2xl backdrop-blur">
              <div className="flex items-start gap-2.5">
                <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border", tone.cls)}>
                  <Icon name={tone.icon} size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold leading-5 text-mist-100">{t.title}</p>
                  {t.description && <p className="mt-0.5 text-xs leading-4 text-mist-400">{t.description}</p>}
                  {t.action && (
                    <button
                      className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-pulse-600/50 bg-pulse-600/15 px-2 py-1 text-xs font-semibold text-pulse-300 hover:bg-pulse-600/30"
                      onClick={() => {
                        Promise.resolve().then(() => t.action?.onClick()).then(() => dismiss(t.id)).catch((e: unknown) => {
                          push({ title: "Action failed", description: e instanceof Error ? e.message : "Please try again", tone: "error" });
                        });
                      }}
                    >
                      <Icon name="undo" size={12} />
                      {t.action.label}
                    </button>
                  )}
                </div>
                <button className="rounded p-1 text-mist-500 hover:text-mist-200" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                  <Icon name="x" size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}