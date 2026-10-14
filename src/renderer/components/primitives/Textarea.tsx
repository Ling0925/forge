import type { TextareaHTMLAttributes } from "react";
import "./forms.css";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly isError?: boolean;
}

export function Textarea({
  isError = false,
  className = "",
  rows = 3,
  ...rest
}: TextareaProps) {
  const classes = ["form-textarea", isError ? "is-error" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <textarea
      rows={rows}
      className={classes}
      aria-invalid={isError ? "true" : undefined}
      {...rest}
    />
  );
}
