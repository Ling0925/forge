import type { InputHTMLAttributes } from "react";
import "./forms.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly isMono?: boolean;
  readonly isError?: boolean;
}

export function Input({
  isMono = false,
  isError = false,
  className = "",
  type = "text",
  ...rest
}: InputProps) {
  const classes = [
    "form-input",
    isMono ? "form-input-mono" : "",
    isError ? "is-error" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <input
      type={type}
      className={classes}
      aria-invalid={isError ? "true" : undefined}
      {...rest}
    />
  );
}
