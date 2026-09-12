"use client";

import { useEffect, useRef } from "react";

/** Keeps keyboard users inside each dialog and returns focus to its opener. */
export function useDialogFocus(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirst = () => {
      const first = dialog?.querySelector<HTMLElement>(focusableSelector);
      first?.focus();
    };
    const frame = window.requestAnimationFrame(focusFirst);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (Array.from(document.querySelectorAll('[aria-modal="true"]')).at(-1) !== dialog) return;
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (active && !dialog.contains(active)) {
        // Another dialog stacked on top owns the focus; leave it alone, or two
        // traps fight over every Tab and neither ever advances.
        if (active.closest('[aria-modal="true"]')) return;
        // Focus fell out of the dialog — a focused control was unmounted or
        // disabled. Bring it back instead of letting Tab leave the dialog.
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  return dialogRef;
}

export function FormError({ message }: { message?: string }) {
  return message ? <p role="alert" className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-3 text-sm text-rose-200">{message}</p> : null;
}
