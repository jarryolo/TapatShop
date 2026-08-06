"use client";

import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

import { cn } from "@/lib/utils/cn";

export type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside a ToastProvider");
  return context;
}

const TONES: Record<ToastTone, string> = {
  success: "border-success bg-success-soft text-text",
  error: "border-danger bg-danger-soft text-text",
  info: "border-brand-200 bg-brand-50 text-text",
};

/**
 * Toasts, announced to screen readers.
 *
 * The live region is `polite` and always present in the DOM — a region added at the same
 * moment as its content is frequently not announced at all. Errors use `assertive` because
 * "that coupon has expired" is not something to hear after the next three actions.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, message }]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 md:bottom-auto md:right-0 md:top-0 md:items-end"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            aria-live={t.tone === "error" ? "assertive" : "polite"}
            className={cn(
              "pointer-events-auto w-full max-w-sm rounded-[var(--radius-ctrl)] border-l-4 px-4 py-3 text-sm shadow-[var(--shadow-card)]",
              TONES[t.tone]
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * A standalone announcer for things that are not toasts — stock changes and cart updates,
 * which docs/05 requires be announced.
 */
export function LiveRegion({
  message,
  assertive = false,
}: {
  message: string;
  assertive?: boolean;
}) {
  return (
    <div
      className="sr-only-live"
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
    >
      {message}
    </div>
  );
}
