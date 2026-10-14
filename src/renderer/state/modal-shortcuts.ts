import { useEffect, useRef } from "react";

/**
 * Focused arbitration helpers for global modal shortcuts.
 *
 * The native <dialog> element is the single source of truth for "a modal is
 * open", so the guard also covers local panel dialogs (MCP, checkpoint
 * restore, session rename) without importing any of those components.
 */

/** The topmost open native modal dialog, if any. */
export function findOpenModalDialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>("dialog[open]");
}

/**
 * Run `run` only once every open native dialog has actually closed; dialog
 * close happens in a passive effect, so it may not have flushed by the next
 * frame. If any modal is still open after a bounded number of frames the
 * handoff is abandoned and never invoked, even if the dialog closes later.
 */
export function afterModalsClosed(run: () => void): void {
  let attempts = 0;
  const step = () => {
    if (!findOpenModalDialog()) {
      run();
      return;
    }
    if (attempts >= 30) return;
    attempts += 1;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Global new-task / settings shortcut handling that refuses to stack an
 * ordinary dialog while any modal is open. Escape stays a plain notification
 * so each host decides its own non-dialog behavior (e.g. mobile sidebar).
 */
export function useGlobalModalShortcuts(handlers: {
  readonly onNewSession: (isOpen: boolean) => void;
  readonly onSettings: (isOpen: boolean) => void;
  readonly onEscape: () => void;
}): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (findOpenModalDialog()) return;
        latest.current.onNewSession(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        if (findOpenModalDialog()) return;
        latest.current.onSettings(true);
      }
      if (event.key === "Escape") latest.current.onEscape();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
}
