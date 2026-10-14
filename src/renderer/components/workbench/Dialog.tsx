import { X } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { Button } from "../primitives/Button";

export function Dialog({
  title,
  kicker,
  open = true,
  onClose,
  children,
  initialFocus,
}: {
  readonly title: string;
  readonly kicker?: string;
  readonly open?: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly initialFocus?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    if (!open) return;
    dialog?.showModal();
    if (initialFocus) dialog?.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, initialFocus]);
  return (
    <dialog
      ref={ref}
      className="modal-card native-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
    >
      <header className="modal-header">
        <div className="modal-heading">
          <h2 className="modal-title">{title}</h2>
          {kicker ? <p className="modal-kicker wb-muted">{kicker}</p> : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="modal-close"
          onClick={onClose}
          aria-label="关闭面板"
        >
          <X size={16} aria-hidden="true" />
        </Button>
      </header>
      {children}
    </dialog>
  );
}
