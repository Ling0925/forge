import { Tray } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import "./states.css";

export interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
  readonly icon?: ReactNode;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <section className={`empty-state ${className}`.trim()} aria-label={title}>
      <div className="empty-state-icon" aria-hidden="true">
        {icon ?? <Tray size={24} weight="regular" />}
      </div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
      {(actionLabel || action) && (
        <div className="empty-state-action">
          {action ? (
            action
          ) : actionLabel && onAction ? (
            <Button variant="secondary" onClick={onAction}>
              {actionLabel}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
