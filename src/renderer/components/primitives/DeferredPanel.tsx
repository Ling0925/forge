import { Component, type ComponentType, lazy, type LazyExoticComponent, Suspense, useEffect, useState } from "react";
import { Button } from "./Button";

interface PanelProps {
  readonly open: boolean;
  readonly label: string;
  readonly onClose: () => void;
  readonly load: () => Promise<{ default: ComponentType }>;
}

function Placeholder({
  label, onClose, onRetry,
}: Pick<PanelProps, "label" | "onClose"> & { onRetry?: () => void }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100, display: "grid",
      placeContent: "center", gap: 16, padding: 24, background: "var(--surface-shell)",
    }}>
      <p role={onRetry ? "alert" : "status"}>
        {onRetry ? `${label}加载失败，请重试；若仍失败或服务已更新，可刷新页面。` : `正在加载${label}…`}
      </p>
      {onRetry && <Button variant="primary" onClick={onRetry}>重试</Button>}
      <Button onClick={onClose}>返回工作台</Button>
      {onRetry && <Button onClick={() => window.location.reload()}>刷新页面</Button>}
    </div>
  );
}

// Vite remembers failed CSS preloads as visited. Merely calling import() again
// skips that stylesheet, leaving an unstyled panel. Retry its existing link
// before allowing the module to render; don't invent URLs or reload the page.
async function retryPanelLoad(load: PanelProps["load"], error: unknown) {
  const cssErrorPrefix = "Unable to preload CSS for ";
  if (error instanceof Error && error.message.startsWith(cssErrorPrefix)) {
    const href = new URL(error.message.slice(cssErrorPrefix.length), document.baseURI).href;
    const link = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
      .find(candidate => candidate.href === href);
    if (!link) throw error;
    // A failed download can still leave a non-null, empty link.sheet.
    await new Promise<void>((resolve, reject) => {
      const replacement = link.cloneNode() as HTMLLinkElement;
      replacement.addEventListener("load", () => resolve(), { once: true });
      replacement.addEventListener("error", () => reject(error), { once: true });
      link.replaceWith(replacement);
    });
  }
  return load();
}

interface PanelState {
  readonly failed: boolean;
  readonly error?: unknown;
  readonly Panel: LazyExoticComponent<ComponentType>;
}

class PanelBoundary extends Component<PanelProps, PanelState> {
  override state: PanelState = { failed: false, Panel: lazy(this.props.load) };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  override componentDidUpdate(previous: PanelProps) {
    if (this.state.failed && this.props.open && !previous.open) this.retry();
  }

  // React.lazy caches rejected promises, so resetting only the boundary would
  // immediately throw the same error again. Keep successful mounts intact.
  private retry = () => {
    const { load } = this.props;
    const { error } = this.state;
    this.setState({ failed: false, error: undefined, Panel: lazy(() => retryPanelLoad(load, error)) });
  };

  override render() {
    const { open, label, onClose } = this.props;
    const { Panel } = this.state;
    if (this.state.failed) return open ? <Placeholder label={label} onClose={onClose} onRetry={this.retry} /> : null;
    return (
      <Suspense fallback={open ? <Placeholder label={label} onClose={onClose} /> : null}>
        <Panel />
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
