import type { ReactNode } from "react";
import "./layout.css";

export interface PanelSplitProps {
  readonly sidebar?: ReactNode;
  readonly main: ReactNode;
  readonly inspector?: ReactNode;
  readonly className?: string;
}

export function PanelSplit({
  sidebar,
  main,
  inspector,
  className = "",
}: PanelSplitProps) {
  return (
    <div className={`panel-split ${className}`.trim()}>
      {sidebar && (
        <aside className="panel-sidebar" aria-label="侧边会话栏">
          {sidebar}
        </aside>
      )}
      <section className="panel-main" aria-label="主任务执行区">
        {main}
      </section>
      {inspector && (
        <aside className="panel-inspector" aria-label="检查区">
          {inspector}
        </aside>
      )}
    </div>
  );
}
