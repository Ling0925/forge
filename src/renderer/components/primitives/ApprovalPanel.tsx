import { ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { Button } from "./Button";
import "./approval-panel.css";

export interface ApprovalPanelProps {
  readonly toolName: string;
  readonly description: string;
  readonly command?: readonly string[] | string;
  readonly cwd?: string;
  readonly targetPath?: string;
  readonly riskNotice?: string;
  readonly isInvalid?: boolean;
  readonly isSubmitting?: boolean;
  readonly onApprove: () => void;
  readonly onReject: () => void;
  readonly className?: string;
}

export function ApprovalPanel({
  toolName,
  description,
  command,
  cwd,
  targetPath,
  riskNotice,
  isInvalid = false,
  isSubmitting = false,
  onApprove,
  onReject,
  className = "",
}: ApprovalPanelProps) {
  const formattedCommand = Array.isArray(command) ? command.join(" ") : command;
  const hasCommandRequirement =
    toolName === "run_command" || toolName.includes("shell");
  const isCommandIncomplete =
    hasCommandRequirement &&
    (!formattedCommand ||
      (typeof formattedCommand === "string"
        ? formattedCommand.trim() === ""
        : false));

  return (
    <section
      className={`approval-panel ${isInvalid ? "is-invalid" : ""} ${className}`.trim()}
      aria-label="操作审批请求"
    >
      <div className="approval-header">
        <ShieldCheck
          size={24}
          weight="bold"
          className="approval-icon"
          aria-hidden="true"
        />
        <div className="approval-title-area">
          <div className="approval-title">
            <span>待批准执行：</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--neutral-3)",
                padding: "1px 6px",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-xs)",
              }}
            >
              {toolName}
            </span>
          </div>
          <div className="approval-description">{description}</div>
        </div>
      </div>

      {formattedCommand && (
        <div className="approval-command-box">
          <span className="approval-command-label">待执行命令：</span>
          <code className="approval-command-content">{formattedCommand}</code>
        </div>
      )}

      {targetPath && (
        <div className="approval-command-box">
          <span className="approval-command-label">目标路径：</span>
          <code className="approval-command-content">{targetPath}</code>
        </div>
      )}

      {cwd && <div className="approval-cwd">执行目录：{cwd}</div>}

      {riskNotice && (
        <div className="approval-risk">
          <WarningCircle size={14} weight="bold" aria-hidden="true" />
          <span>风险提示：{riskNotice}</span>
        </div>
      )}

      {isInvalid ? (
        <div className="approval-invalid-msg">请求已失效，请重新运行。</div>
      ) : (
        <div className="approval-actions">
          <Button
            variant="primary"
            onClick={onApprove}
            disabled={isSubmitting || isCommandIncomplete}
            loading={isSubmitting}
          >
            允许本次
          </Button>
          <Button
            variant="secondary"
            onClick={onReject}
            disabled={isSubmitting}
          >
            拒绝
          </Button>
          {isCommandIncomplete && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--error)" }}>
              命令不完整，禁止批准
            </span>
          )}
        </div>
      )}
    </section>
  );
}
