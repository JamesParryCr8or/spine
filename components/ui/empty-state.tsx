import * as React from "react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** A button or link that fixes the emptiness. */
  action?: React.ReactNode;
  className?: string;
};

/** Explains why a list is empty and what to do about it. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-10 text-center", className)}>
      {icon && <span aria-hidden="true" className="mb-3 grid size-11 place-items-center rounded-full bg-ds-accent-soft text-ds-accent [&_svg]:size-5">{icon}</span>}
      <strong className="text-ds-body font-semibold text-ds-ink">{title}</strong>
      {description && <p className="mt-1 max-w-[46ch] text-ds-small text-ds-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
