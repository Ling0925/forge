import type { ReactNode } from "react";
import "./layout.css";

export interface ShellProps {
  readonly title?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Shell({
  title = "Forge",
  actions,
  children,
  className = "",
}: ShellProps) {
  return (
    <div className={`app-shell ${className}`.trim()}>
      <header className="shell-header">
        <div className="shell-header-title">{title}</div>
        {actions && <div className="shell-header-actions">{actions}</div>}
      </header>
      <main className="shell-body">{children}</main>
    </div>
  );
}
