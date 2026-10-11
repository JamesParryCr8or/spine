"use client";

import * as React from "react";
import { X } from "lucide-react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  description?: React.ReactNode;
  /** Buttons for the bottom edge (Cancel, Save). */
  footer?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * A dialog built on the native <dialog> element: the browser traps focus,
 * closes on Esc, returns focus to the opener and marks the page behind inert.
 * Clicking the dimmed backdrop also closes it. Content is mounted only while
 * open, so each opening starts fresh.
 */
export function Modal({ open, onClose, title, eyebrow, description, footer, children }: ModalProps) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
      className="m-auto w-[min(580px,calc(100vw-32px))] max-h-[calc(100vh-48px)] overflow-hidden rounded-ds border border-ds-line bg-ds-surface p-0 text-ds-ink shadow-[0_24px_60px_rgb(23_32_51/25%)] backdrop:bg-[rgb(23_32_51/45%)]"
    >
      {open && (
        <div className="flex max-h-[calc(100vh-48px)] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-ds-line px-6 py-4">
            <div className="min-w-0">
              {eyebrow && <span className="block text-ds-label uppercase text-ds-muted">{eyebrow}</span>}
              <h2 id={titleId} className="mt-0.5 text-ds-title">{title}</h2>
              {description && <p className="mt-1 text-ds-small text-ds-muted">{description}</p>}
            </div>
            <button type="button" aria-label="Close" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-ds-sm text-ds-muted hover:bg-ds-canvas hover:text-ds-ink"><X className="size-4" /></button>
          </header>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-ds-line bg-ds-canvas px-6 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
