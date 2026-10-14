import { WarningCircle } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import "./forms.css";

export interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly optional?: boolean | undefined;
  readonly helper?: string | undefined;
  readonly error?: string | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}

export function Field({
  id,
  label,
  optional = false,
  helper,
  error,
  children,
  className = "",
}: FieldProps) {
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;

  return (
    <div className={`form-field ${className}`.trim()}>
      <label htmlFor={id} className="form-label">
        <span>{label}</span>
        {optional && <span className="form-label-optional">（可选）</span>}
      </label>
      <div className="form-control-wrap">{children}</div>
      {error && (
        <div id={errorId} className="form-error" role="alert">
          <WarningCircle size={14} weight="bold" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {!error && helper && (
        <div id={helperId} className="form-helper">
          {helper}
        </div>
      )}
    </div>
  );
}

export interface SettingRowProps {
  readonly label: string;
  readonly description?: string | undefined;
  readonly error?: string | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}

export function SettingRow({
  label,
  description,
  error,
  children,
  className = "",
}: SettingRowProps) {
  return (
    <div className={`form-row ${className}`.trim()}>
      <div className="form-row-info">
        <span className="form-label">{label}</span>
        {description && <span className="form-helper">{description}</span>}
        {error && (
          <div className="form-error" role="alert">
            <WarningCircle size={14} weight="bold" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>
      <div className="form-row-control">{children}</div>
    </div>
  );
}
