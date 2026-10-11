import * as React from "react";

import { cn } from "@/lib/utils";

type PanelProps = {
  eyebrow?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Buttons or controls aligned to the right of the heading. */
  actions?: React.ReactNode;
  /** Remove the body padding, for tables that run edge to edge. */
  flush?: boolean;
  className?: string;
  children?: React.ReactNode;
};

/** The standard content block: eyebrow, title, description, actions and a padded body. */
export function Panel({ eyebrow, title, description, actions, flush = false, className, children }: PanelProps) {
  const hasHeader = Boolean(eyebrow || title || description || actions);
  return (
    <section className={cn("mb-4 overflow-hidden rounded-ds border border-ds-line bg-ds-surface shadow-ds", className)}>
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0 max-w-[70ch]">
            {eyebrow && <span className="block text-ds-label uppercase text-ds-muted">{eyebrow}</span>}
            {title && <h2 className="mt-1 text-ds-title text-ds-ink">{title}</h2>}
            {description && <p className="mt-1 text-ds-small text-ds-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && "px-5 pb-5", hasHeader ? "pt-4" : !flush && "pt-5")}>{children}</div>
    </section>
  );
}
