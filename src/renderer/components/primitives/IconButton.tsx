import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./buttons.css";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  readonly label: string;
  readonly icon: ReactNode;
  readonly variant?: "secondary" | "ghost" | "danger";
  readonly size?: "sm" | "md" | "lg";
  readonly loading?: boolean;
}

export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  loading = false,
  disabled = false,
  className = "",
  type = "button",
  ...rest
}: IconButtonProps) {
  const classes = [
    "btn",
    "btn-icon",
    `btn-${variant}`,
    `btn-${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      className={classes}
      disabled={isDisabled}
      aria-label={label}
      title={label}
      aria-busy={loading ? "true" : undefined}
      {...rest}
    >
      {loading ? (
        <span className="btn-spinner" aria-hidden="true" />
      ) : (
        <span aria-hidden="true" style={{ display: "inline-flex" }}>
          {icon}
        </span>
      )}
    </button>
  );
}
