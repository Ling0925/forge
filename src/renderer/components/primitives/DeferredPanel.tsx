import { Component, type ReactNode, Suspense, useEffect, useState } from "react";
import { Button } from "./Button";

interface PanelProps {
  readonly open: boolean;
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

function Placeholder({
  label, onClose, failed = false,
}: Pick<PanelProps, "label" | "onClose"> & { failed?: boolean }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100, display: "grid",
      placeContent: "center", gap: 16, padding: 24, background: "var(--surface-shell)",
    }}>
      <p role={failed ? "alert" : "status"}>
        {failed ? `${label}加载失败，请检查网络；如已更新服务，请刷新页面。` : `正在加载${label}…`}
      </p>
      <Button onClick={onClose}>返回工作台</Button>
    </div>
  );
}

class PanelBoundary extends Component<PanelProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    const { open, label, onClose, children } = this.props;
    if (this.state.failed) return open ? <Placeholder label={label} onClose={onClose} failed /> : null;
    return (
      <Suspense fallback={open ? <Placeholder label={label} onClose={onClose} /> : null}>
        {children}
      </Suspense>
    );
  }
}

/** Load on first use, then retain mounted drafts/filters when the panel closes. */
export function DeferredPanel(props: PanelProps) {
  const [visited, setVisited] = useState(props.open);
  useEffect(() => {
    if (props.open) setVisited(true);
  }, [props.open]);
  if (!props.open && !visited) return null;
  return <PanelBoundary {...props} />;
}
