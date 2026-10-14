import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./buttons.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "primary" | "secondary" | "ghost" | "danger";
  readonly size?: "sm" | "md" | "lg";
  readonly loading?: boolean;
  readonly icon?: ReactNode;
  readonly children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled = false,
  icon,
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, `btn-${size}`, className]
    .filter(Boolean)
    .join(" ");

  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      className={classes}
      disabled={isDisabled}
      aria-busy={loading ? "true" : undefined}
      {...rest}
    >
      {loading ? (
        <span className="btn-spinner" aria-hidden="true" />
      ) : (
        icon && (
          <span aria-hidden="true" style={{ display: "inline-flex" }}>
            {icon}
          </span>
        )
      )}
      {children}
      {loading && <span className="btn-busy-status">进行中</span>}
    </button>
  );
}
