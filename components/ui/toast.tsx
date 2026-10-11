"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, Info } from "lucide-react";

import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";
type ToastInput = { title: string; description?: string; tone?: ToastTone };
type ToastItem = ToastInput & { id: number };

const ToastContext = React.createContext<{ toast: (input: ToastInput) => void } | null>(null);
const icons = { success: CheckCircle2, error: CircleAlert, info: Info } as const;
const tones: Record<ToastTone, string> = {
  success: "border-ds-positive/30 [&_svg]:text-ds-positive",
  error: "border-ds-negative/30 [&_svg]:text-ds-negative",
  info: "border-ds-line-strong [&_svg]:text-ds-accent",
};

/** Mount once near the root. Toasts announce themselves to screen readers and dismiss themselves (errors stay longer). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const counter = React.useRef(0);

  const toast = React.useCallback((input: ToastInput) => {
    counter.current += 1;
    const id = counter.current;
    setItems((current) => [...current.slice(-3), { ...input, id }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), input.tone === "error" ? 8000 : 4000);
  }, []);
  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
        {items.map((item) => {
          const tone = item.tone ?? "info";
          const Icon = icons[tone];
          return (
            <div key={item.id} className={cn("pointer-events-auto flex items-start gap-3 rounded-ds border bg-ds-surface px-4 py-3 shadow-[0_8px_30px_rgb(23_32_51/16%)]", tones[tone])}>
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <strong className="block text-ds-small font-semibold text-ds-ink">{item.title}</strong>
                {item.description && <span className="block text-ds-small text-ds-muted">{item.description}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns a no-op outside a provider, so a component never crashes for lack of one. */
export function useToast() {
  return React.useContext(ToastContext) ?? { toast: () => {} };
}
