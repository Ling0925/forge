import { ArrowSquareOut, Clock } from "@phosphor-icons/react";
import { Shell } from "../components/layout/Shell";
import { Button } from "../components/primitives/Button";

export interface BootstrapScreenProps {
  readonly onOpenShowcase: () => void;
}

export function BootstrapScreen({ onOpenShowcase }: BootstrapScreenProps) {
  return (
    <Shell title="Forge 桌面工作台">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          padding: "var(--space-6)",
          textAlign: "center",
          gap: "var(--space-4)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "56px",
            height: "56px",
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--neutral-2)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
          aria-hidden="true"
        >
          <Clock size={28} weight="regular" />
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            maxWidth: "480px",
          }}
        >
          <h2 style={{ fontSize: "var(--text-xl)", fontWeight: 600 }}>
            Forge 桌面工作台初始化中
          </h2>
          <p
            style={{
              fontSize: "var(--text-base)",
              color: "var(--text-secondary)",
              lineHeight: "var(--leading-base)",
            }}
          >
            阶段 1 视觉原语与设计契约已构建完成。
            正在等待下一阶段应用组合与运行时接入。当前状态未连接到运行时，不展示虚构的执行结果。
          </p>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-2)",
            marginTop: "var(--space-2)",
          }}
        >
          <Button
            variant="primary"
            icon={<ArrowSquareOut size={16} weight="bold" />}
            onClick={onOpenShowcase}
          >
            打开设计原语展示 (?showcase=1)
          </Button>
          <span
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
            }}
          >
            点击可进入全部 UI 原语、明暗主题与视口断点评审环境
          </span>
        </div>
      </div>
    </Shell>
  );
}
