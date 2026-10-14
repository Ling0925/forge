import type { SelectHTMLAttributes } from "react";
import "./forms.css";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly options?: readonly SelectOption[];
  readonly placeholder?: string;
  readonly isError?: boolean;
}

export function Select({
  options,
  placeholder,
  isError = false,
  className = "",
  children,
  ...rest
}: SelectProps) {
  const classes = ["form-select", isError ? "is-error" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <select
      className={classes}
      aria-invalid={isError ? "true" : undefined}
      {...rest}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options
        ? options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))
        : children}
    </select>
  );
}
