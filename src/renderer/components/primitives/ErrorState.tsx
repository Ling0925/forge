import { WarningOctagon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { ErrorInfo } from "../../shared-types";
import { Button } from "./Button";
import "./states.css";

export interface ErrorStateProps {
  readonly title: string;
  readonly error: string | ErrorInfo;
  readonly impact?: string;
  readonly retryable?: boolean;
  readonly onRetry?: () => void;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function ErrorState({
  title,
  error,
  impact,
  retryable = false,
  onRetry,
  actions,
  className = "",
}: ErrorStateProps) {
  const errorMessage = typeof error === "string" ? error : error.message;
  const errorCode = typeof error === "object" ? error.code : undefined;
  const isRetryable = typeof error === "object" ? error.retryable : retryable;

  return (
    <div className={`error-state ${className}`.trim()} role="alert">
      <div className="error-state-header">
        <WarningOctagon
          size={24}
          weight="fill"
          className="error-state-icon"
          aria-hidden="true"
        />
        <div className="error-state-content">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 className="error-state-title">{title}</h3>
            {errorCode && (
              <span
                style={{
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  background: "var(--neutral-3)",
                  padding: "1px 6px",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text-secondary)",
                }}
              >
                {errorCode}
              </span>
            )}
          </div>
          <div className="error-state-message">{errorMessage}</div>
          {impact && <div className="error-state-impact">影响：{impact}</div>}
        </div>
      </div>
      {(isRetryable && onRetry) || actions ? (
        <div className="error-state-actions">
          {isRetryable && onRetry && (
            <Button variant="danger" size="sm" onClick={onRetry}>
              重试
            </Button>
          )}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
