import * as React from "react";

import { cn } from "@/lib/utils";

const controlClass = "h-10 w-full rounded-ds-sm border border-ds-line-strong bg-ds-surface px-3 text-ds-body text-ds-ink placeholder:text-ds-muted/70 focus-visible:border-ds-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ds-accent/30 disabled:cursor-not-allowed disabled:bg-ds-canvas disabled:opacity-70 aria-[invalid=true]:border-ds-negative";

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(controlClass, className)} {...props} />,
);
TextInput.displayName = "TextInput";

export const SelectInput = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(controlClass, "pr-8", className)} {...props} />,
);
SelectInput.displayName = "SelectInput";

type FormFieldProps = {
  label: React.ReactNode;
  /** Helper text under the control. */
  hint?: React.ReactNode;
  error?: React.ReactNode;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
};

/** A label, a control and optional hint or error text. The label wraps the control, so clicking it focuses the control. */
export function FormField({ label, hint, error, optional = false, className, children }: FormFieldProps) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-ds-small font-semibold text-ds-ink">
        {label}
        {optional && <span className="ml-1.5 font-normal text-ds-muted">Optional</span>}
      </span>
      {children}
      {error ? <span role="alert" className="text-ds-small text-ds-negative">{error}</span> : hint ? <span className="text-ds-small text-ds-muted">{hint}</span> : null}
    </label>
  );
}

/** Responsive grid for form fields: one column on phones, two from the small breakpoint. */
export function FormGrid({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("grid gap-x-4 gap-y-4 sm:grid-cols-2", className)}>{children}</div>;
}
