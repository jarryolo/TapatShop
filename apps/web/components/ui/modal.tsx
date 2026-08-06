"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Built on the native <dialog>.
 *
 * showModal() gives focus trapping, Escape to close, inert background content, and the
 * top-layer stacking that avoids z-index fights — all of it from the platform, none of it
 * ours to get subtly wrong.
 */
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // Fires for Escape as well as close(), so both paths tell the parent.
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  return ref;
}

/** Clicking the backdrop closes. The check is on the dialog itself, which is the backdrop. */
function backdropClose(onClose: () => void) {
  return (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useDialog(open, onClose);
  // Generated, not hardcoded: two modals mounted at once would otherwise share an id and
  // the second one's label would point at the first one's heading.
  const titleId = useId();
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

  return (
    <dialog
      ref={ref}
      onClick={backdropClose(onClose)}
      aria-labelledby={titleId}
      className={cn(
        "m-auto w-[calc(100vw-2rem)] rounded-[var(--radius-card)] bg-surface p-0 text-text",
        "shadow-[var(--shadow-raised)] backdrop:bg-[rgba(16,21,28,0.45)]",
        widths[size]
      )}
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-xl font-semibold">
              {title}
            </h2>
            {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-2 rounded-[var(--radius-ctrl)] p-2 text-text-muted hover:bg-page hover:text-text"
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {children ? <div className="mt-4">{children}</div> : null}
        {footer ? <div className="mt-6 flex justify-end gap-3">{footer}</div> : null}
      </div>
    </dialog>
  );
}

/**
 * Side and bottom sheet. Same dialog machinery, different geometry: a drawer on desktop,
 * a bottom sheet on mobile where reaching the top of the screen is awkward.
 */
export function Sheet({
  open,
  onClose,
  title,
  side = "right",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "right" | "bottom";
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useDialog(open, onClose);
  const titleId = useId();

  return (
    <dialog
      ref={ref}
      onClick={backdropClose(onClose)}
      aria-labelledby={titleId}
      className={cn(
        "bg-surface p-0 text-text shadow-[var(--shadow-raised)] backdrop:bg-[rgba(16,21,28,0.45)]",
        side === "right"
          ? "ml-auto mr-0 my-0 h-dvh max-h-none w-full max-w-md rounded-none"
          : "mx-auto mb-0 mt-auto max-h-[85dvh] w-full max-w-none rounded-t-[var(--radius-card)]"
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-2 rounded-[var(--radius-ctrl)] p-2 text-text-muted hover:bg-page hover:text-text"
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? <div className="border-t border-border-subtle px-5 py-4">{footer}</div> : null}
      </div>
    </dialog>
  );
}
