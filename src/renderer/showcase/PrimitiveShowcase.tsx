import {
  ArrowClockwise,
  CheckCircle,
  Copy,
  Gear,
  Moon,
  Play,
  Stop,
  Sun,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { PanelSplit } from "../components/layout/PanelSplit";
import { ApprovalPanel } from "../components/primitives/ApprovalPanel";
import { Button } from "../components/primitives/Button";
import { CodeBlock } from "../components/primitives/CodeBlock";
import { DiffViewer } from "../components/primitives/DiffViewer";
import { EmptyState } from "../components/primitives/EmptyState";
import { ErrorState } from "../components/primitives/ErrorState";
import { Field, SettingRow } from "../components/primitives/Field";
import { IconButton } from "../components/primitives/IconButton";
import { Input } from "../components/primitives/Input";
import { Select } from "../components/primitives/Select";
import { StatusBadge } from "../components/primitives/StatusBadge";
import { Tabs } from "../components/primitives/Tabs";
import { Textarea } from "../components/primitives/Textarea";
import { ToolDisclosure } from "../components/primitives/ToolDisclosure";
import {
  SAMPLE_CODE,
  SAMPLE_FILE_CHANGE,
  SAMPLE_MODELS,
  SAMPLE_PACKAGE_FILE_CHANGE,
  SAMPLE_PERMISSIONS,
  SAMPLE_TRUNCATED_FILE_CHANGE,
} from "./showcase-data";
import "./showcase.css";

type ThemeMode = "system" | "dark" | "light";
type ViewportWidth =
  | "100%"
  | "390px"
  | "768px"
  | "1024px"
  | "1440px"
  | "1920px";

export function PrimitiveShowcase() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("forge:theme");
    return saved === "dark" || saved === "light" || saved === "system"
      ? saved
      : "dark";
  });

  const [viewportWidth, setViewportWidth] = useState<ViewportWidth>("100%");
  const [activeTab, setActiveTab] = useState("buttons");

  // Interactive Run/Stop state machine simulation
  const [runState, setRunState] = useState<"idle" | "running" | "stopping">(
    "idle",
  );

  // Interactive Approval state
  const [approvalStatus, setApprovalStatus] = useState<
    "pending" | "submitting" | "approved" | "rejected" | "invalid"
  >("pending");

  // Form states
  const [demoInput, setDemoInput] = useState("src/renderer/main.tsx");
  const [demoModel, setDemoModel] = useState("anthropic/claude-3.5-sonnet");
  const [demoPermission, setDemoPermission] = useState("workspace");
  const [demoTextarea, setDemoTextarea] = useState(
    "帮我重构一下格式化输出逻辑，确保在不同屏幕尺寸下均能正确换行。",
  );
  const [showInputError, setShowInputError] = useState(false);

  // Apply theme
  useEffect(() => {
    localStorage.setItem("forge:theme", theme);
    const root = document.documentElement;
    if (theme === "system") {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.setAttribute("data-theme", isDark ? "dark" : "light");

      const listener = (e: MediaQueryListEvent) => {
        root.setAttribute("data-theme", e.matches ? "dark" : "light");
      };
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      mql.addEventListener("change", listener);
      return () => mql.removeEventListener("change", listener);
    }
    root.setAttribute("data-theme", theme);
  }, [theme]);

  // Handle run demo click
  const handleRunClick = () => {
    if (runState === "idle") {
      setRunState("running");
    } else if (runState === "running") {
      setRunState("stopping");
      setTimeout(() => setRunState("idle"), 1200);
    }
  };

  return (
    <div className="showcase-root">
      {/* Top control bar */}
      <header className="showcase-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <h1 style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>
            Forge 原语工坊
          </h1>
          <span className="showcase-badge" role="note">
            示例数据 · 非运行时连接
          </span>
        </div>

        <div className="showcase-controls">
          {/* Viewport width simulator */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
              }}
            >
              视口宽度：
            </span>
            <div className="showcase-segmented" aria-label="视口宽度切换">
              {(
                [
                  "100%",
                  "390px",
                  "768px",
                  "1024px",
                  "1440px",
                  "1920px",
                ] as const
              ).map((w) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={viewportWidth === w}
                  className={`showcase-seg-btn ${viewportWidth === w ? "is-active" : ""}`}
                  onClick={() => setViewportWidth(w)}
                >
                  {w === "100%" ? "自适应" : w}
                </button>
              ))}
            </div>
          </div>

          {/* Theme switcher */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
              }}
            >
              主题：
            </span>
            <div className="showcase-segmented" aria-label="主题切换">
              <button
                type="button"
                aria-pressed={theme === "dark"}
                className={`showcase-seg-btn ${theme === "dark" ? "is-active" : ""}`}
                onClick={() => setTheme("dark")}
              >
                <Moon
                  size={12}
                  style={{ display: "inline-block", verticalAlign: "middle" }}
                />{" "}
                深色
              </button>
              <button
                type="button"
                aria-pressed={theme === "light"}
                className={`showcase-seg-btn ${theme === "light" ? "is-active" : ""}`}
                onClick={() => setTheme("light")}
              >
                <Sun
                  size={12}
                  style={{ display: "inline-block", verticalAlign: "middle" }}
                />{" "}
                明亮
              </button>
              <button
                type="button"
                aria-pressed={theme === "system"}
                className={`showcase-seg-btn ${theme === "system" ? "is-active" : ""}`}
                onClick={() => setTheme("system")}
              >
                系统
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Viewport Container */}
      <div className="showcase-viewport-wrap">
        <div
          className="showcase-viewport-frame"
          style={{ maxWidth: viewportWidth }}
          aria-label="原语展示内容区"
        >
          <div className="showcase-body">
            {/* Category Navigation Tabs */}
            <Tabs
              ariaLabel="原语分类导航"
              activeId={activeTab}
              onChange={setActiveTab}
              tabs={[
                { id: "buttons", label: "01 按钮与交互" },
                { id: "forms", label: "02 表单与字段" },
                { id: "badges", label: "03 状态徽标" },
                { id: "states", label: "04 空态与错误" },
                { id: "tools", label: "05 工具执行披露" },
                { id: "code", label: "06 代码与差异" },
                { id: "approval", label: "07 审批与权限" },
                { id: "layout", label: "08 响应式分栏" },
              ]}
            />

            {/* TAB 1: Buttons & Actions */}
            {activeTab === "buttons" && (
              <div className="showcase-col">
                <section className="showcase-section">
                  <div className="showcase-section-header">
                    <h2 className="showcase-section-title">
                      <span>按钮变体与状态 (Button Variants & States)</span>
                      <span className="showcase-badge">示例数据</span>
                    </h2>
                    <p className="showcase-section-desc">
                      中性高对比主运行按钮、次级操作、幽灵按钮、危险动作。支持
                      loading、disabled、focus 环。
                    </p>
                  </div>

                  <div className="showcase-col">
                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                      }}
                    >
                      常规尺寸 (36px 控件高度)
                    </span>
                    <div className="showcase-row">
                      <Button
                        variant="primary"
                        icon={<Play size={16} weight="fill" />}
                      >
                        运行任务
                      </Button>
                      <Button variant="secondary">次级操作</Button>
                      <Button variant="ghost">幽灵按钮</Button>
                      <Button variant="danger">终止会话</Button>
                      <Button variant="secondary" disabled>
                        禁用状态
                      </Button>
                      <Button variant="primary" loading>
                        执行中
                      </Button>
                    </div>

                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        marginTop: "12px",
                      }}
                    >
                      按钮尺寸对比 (sm 28px, md 36px, lg 44px)
                    </span>
                    <div className="showcase-row">
                      <Button size="sm" variant="secondary">
                        小尺寸 (28px)
                      </Button>
                      <Button size="md" variant="secondary">
                        默认尺寸 (36px)
                      </Button>
                      <Button size="lg" variant="secondary">
                        大尺寸 / 触控 (44px)
                      </Button>
                    </div>

                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        marginTop: "12px",
                      }}
                    >
                      图标按钮 (IconButton，具备强制可访问名称)
                    </span>
                    <div className="showcase-row">
                      <IconButton
                        label="运行"
                        icon={<Play size={16} weight="fill" />}
                        variant="secondary"
                      />
                      <IconButton
                        label="停止"
                        icon={<Stop size={16} weight="fill" />}
                        variant="danger"
                      />
                      <IconButton
                        label="设置"
                        icon={<Gear size={16} />}
                        variant="ghost"
                      />
                      <IconButton
                        label="复制"
                        icon={<Copy size={16} />}
                        variant="ghost"
                      />
                      <IconButton
                        label="禁用图标"
                        icon={<ArrowClockwise size={16} />}
                        disabled
                      />
                      <IconButton
                        label="加载中"
                        icon={<ArrowClockwise size={16} />}
                        loading
                      />
                    </div>

                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        marginTop: "12px",
                      }}
                    >
                      交互式运行/停止状态契约演示
                    </span>
                    <div
                      className="showcase-row"
                      style={{ alignItems: "center" }}
                    >
                      {runState === "idle" && (
                        <Button
                          variant="primary"
                          icon={<Play size={16} weight="fill" />}
                          onClick={handleRunClick}
                        >
                          运行任务
                        </Button>
                      )}
                      {runState === "running" && (
                        <Button
                          variant="secondary"
                          icon={<Stop size={16} weight="fill" />}
                          onClick={handleRunClick}
                        >
                          停止
                        </Button>
                      )}
                      {runState === "stopping" && (
                        <Button variant="secondary" loading disabled>
                          正在停止
                        </Button>
                      )}
                      <span
                        style={{
                          fontSize: "var(--text-xs)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        当前状态：
                        {runState === "idle"
                          ? "空闲"
                          : runState === "running"
                            ? "执行中（点击触发停止）"
                            : "正在等待核心确认停止..."}
                      </span>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* TAB 2: Forms & Fields */}
            {activeTab === "forms" && (
              <div className="showcase-col">
                <section className="showcase-section">
                  <div className="showcase-section-header">
                    <h2 className="showcase-section-title">
                      <span>表单输入与字段规范 (Form Fields & Inputs)</span>
                      <span className="showcase-badge">示例数据</span>
                    </h2>
                    <p className="showcase-section-desc">
                      持久 Label、占位符不代替
                      Label、字段级关联错误说明、只读与禁用保持文字清晰可读。
                    </p>
                  </div>

                  <div className="showcase-grid">
                    <Field
                      id="input-path"
                      label="目标文件路径"
                      helper="等宽字体，支持长路径展开"
                    >
                      <Input
                        id="input-path"
                        isMono
                        value={demoInput}
                        onChange={(e) => setDemoInput(e.target.value)}
                        placeholder="例如: src/renderer/main.tsx"
                      />
                    </Field>

                    <Field
                      id="input-error-demo"
                      label="工作区根目录"
                      error={
                        showInputError ? "路径不存在或无权访问" : undefined
                      }
                      helper={
                        showInputError ? undefined : "点击右侧按钮模拟验证错误"
                      }
                    >
                      <div
                        style={{ display: "flex", gap: "8px", width: "100%" }}
                      >
                        <Input
                          id="input-error-demo"
                          defaultValue="/home/ling/services/desktop-harness"
                          isError={showInputError}
                        />
                        <Button
                          size="md"
                          variant="ghost"
                          onClick={() => setShowInputError(!showInputError)}
                        >
                          {showInputError ? "清除错误" : "触发错误"}
                        </Button>
                      </div>
                    </Field>

                    <Field
                      id="input-disabled"
                      label="绑定会话标识 (只读)"
                      helper="会话创建后自动生成，不可篡改"
                    >
                      <Input
                        id="input-disabled"
                        isMono
                        readOnly
                        defaultValue="9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
                      />
                    </Field>

                    <Field
                      id="input-disabled-reason"
                      label="外部环境代理 (已禁用)"
                      helper="当前运行模式下代理配置已锁死"
                    >
                      <Input
                        id="input-disabled-reason"
                        disabled
                        defaultValue="DIRECT"
                      />
                    </Field>
                  </div>

                  <div className="showcase-col" style={{ marginTop: "16px" }}>
                    <Field
                      id="textarea-prompt"
                      label="任务描述 (多行输入)"
                      helper="按 Cmd/Ctrl + Enter 提交任务，Enter 换行"
                    >
                      <Textarea
                        id="textarea-prompt"
                        value={demoTextarea}
                        onChange={(e) => setDemoTextarea(e.target.value)}
                        rows={3}
                      />
                    </Field>
                  </div>

                  <div
                    className="showcase-section-header"
                    style={{ marginTop: "24px" }}
                  >
                    <h3
                      style={{
                        fontSize: "var(--text-base)",
                        fontWeight: 600,
                      }}
                    >
                      安静分组字段行 (Quiet Settings Rows)
                    </h3>
                    <p className="showcase-section-desc">
                      适用于设置、模型切换和权限策略，采用 Sunsama
                      风格中性分层。
                    </p>
                  </div>

                  <div className="showcase-col">
                    <SettingRow
                      label="模型提供方"
                      description="选择当前会话使用的底层模型标识。未选模型写「请选择模型」"
                    >
                      <Select
                        aria-label="选择模型"
                        value={demoModel}
                        onChange={(e) => setDemoModel(e.target.value)}
                        placeholder="请选择模型"
                        options={SAMPLE_MODELS}
                      />
                    </SettingRow>

                    <SettingRow
                      label="授权运行策略"
                      description="默认工作区策略；不自动升级权限，禁止静默扩大执行范围"
                    >
                      <Select
                        aria-label="选择授权策略"
                        value={demoPermission}
                        onChange={(e) => setDemoPermission(e.target.value)}
                        options={SAMPLE_PERMISSIONS}
                      />
                    </SettingRow>

                    <SettingRow
                      label="单次请求超时时间"
                      description="防止网络阻塞挂起会话（默认 60000ms）"
                    >
                      <Input
                        isMono
                        type="number"
                        defaultValue="60000"
                        style={{ maxWidth: "160px" }}
                      />
                    </SettingRow>
                  </div>
                </section>
              </div>
            )}

            {/* TAB 3: Status Badges */}
            {activeTab === "badges" && (
              <div className="showcase-col">
                <section className="showcase-section">
                  <div className="showcase-section-header">
                    <h2 className="showcase-section-title">
                      <span>会话与执行状态徽标 (StatusBadges)</span>
                      <span className="showcase-badge">示例数据</span>
                    </h2>
                    <p className="showcase-section-desc">
                      非交互语义徽标，图标 +
                      文字组合表达。绿色仅表达真实验证通过，琥珀色表达待批准或注意，红色表达失败，未知写「状态未知」。
                    </p>
                  </div>

                  <div className="showcase-row">
                    <StatusBadge status="idle" />
                    <StatusBadge status="queued" />
                    <StatusBadge status="running" />
                    <StatusBadge status="awaiting_approval" />
                    <StatusBadge status="completed" />
                    <StatusBadge status="failed" />
                    <StatusBadge status="cancelled" />
                    <StatusBadge status="interrupted" />
                    <StatusBadge status="unknown" />
                  </div>

                  <div
                    className="showcase-section-header"
                    style={{ marginTop: "24px" }}
                  >
                    <h3
                      style={{
                        fontSize: "var(--text-base)",
                        fontWeight: 600,
                      }}
                    >
                      带自定义文字标签的徽标
                    </h3>
                  </div>

                  <div className="showcase-row">
                    <StatusBadge status="completed" label="测试套件通过" />
                    <StatusBadge
                      status="failed"
                      label="进程非零退出 (exit: 1)"
                    />
                    <StatusBadge
                      status="awaiting_approval"
                      label="等待 Shell 批准"
                    />
                    <StatusBadge status="running" label="代码生成中 (2.4s)" />
                  </div>
                </section>
              </div>
            )}

            {/* TAB 4: Empty & Error States */}
            {activeTab === "states" && (
              <div className="showcase-col">
                <section className="showcase-section">
                  <div className="showcase-section-header">
                    <h2 className="showcase-section-title">
                      <span>空状态与错误状态规范 (Empty & Error States)</span>
                      <span className="showcase-badge">示例数据</span>
                    </h2>
                    <p className="showcase-section-desc">
                      空态具备短标题、原因说明及一个明确操作；错误态提供明确原因、影响评估和可重试动作。
                    </p>
                  </div>

                  <div className="showcase-grid">
                    <div
                      style={{
                        border: "1px dashed var(--border-subtle)",
                        borderRadius: "var(--radius-md)",
                      }}
                    >
                      <EmptyState
                        title="暂无执行记录"
                        description="在下方输入区输入指令并点击运行以开始首次执行。"
                        actionLabel="新建任务会话"
                        onAction={() => {}}
                      />
                    </div>

                    <div
                      style={{
                        border: "1px dashed var(--border-subtle)",
                        borderRadius: "var(--radius-md)",
                      }}
                    >
                      <EmptyState
                        title="未找到匹配证据"
                        description="当前筛选条件下没有匹配的文件变更或终端输出。"
                        actionLabel="重置筛选条件"
                        onAction={() => {}}
                      />
                    </div>
                  </div>

                  <div className="showcase-col" style={{ marginTop: "16px" }}>
                    <h3
                      style={{
                        fontSize: "var(--text-base)",
                        fontWeight: 600,
                      }}
                    >
                      错误状态实例 (ErrorState)
                    </h3>

                    <ErrorState
                      title="模型服务连接超时"
                      error={{
                        code: "provider",
                        message:
                          "ky: timeout of 60000ms exceeded while connecting to https://api.openai.com/v1",
                        retryable: true,
                      }}
                      impact="当前轮次未生成完整答复，工作区文件未作任何修改。"
                      onRetry={() => alert("触发重试动作")}
                    />

                    <ErrorState
                      title="权限边界拒绝"
                      error={{
                        code: "invalid_input",
                        message:
                          "目标路径超出授权工作区范围 (/etc/hosts)，只读策略已阻止越界操作。",
                        retryable: false,
                      }}
                      impact="无法完成越界写入，会话保持当前状态。"
                    />
                  </div>
                </section>
              </div>
            )}

            {/* TAB 5: Tool Activity Disclosures */}
            {activeTab === "tools" && (
              <div className="showcase-col">
                <section className="showcase-section">
                  <div className="showcase-section-header">
                    <h2 className="showcase-section-title">
                      <span>工具执行披露行 (ToolDisclosures)</span>
                      <span className="showcase-badge">示例数据</span>
                    </h2>
                    <p className="showcase-section-desc">
                      支持键盘展开（Enter /
                      Space），摘要包含工具、目标、状态与耗时。空输出写「工具未返回文本」，真实展示退出码与截断标记。
                    </p>
                  </div>

                  <div className="showcase-col">
                    <ToolDisclosure
                      toolName="read_file"
                      target="src/shared/schemas.ts"
                      status="completed"
                      durationMs={18}
                      defaultExpanded={true}
                      parameters={{
                        path: "src/shared/schemas.ts",
                        offset: 0,
                        limit: 50,
                      }}
                      output={
                        'export const sessionIdSchema = z.string().uuid().brand<"SessionId">();\nexport type SessionId = z.infer<typeof sessionIdSchema>;'
                      }
                    />

                    <ToolDisclosure
                      toolName="run_command"
                      target="pnpm test"
                      status="completed"
                      durationMs={1420}
                      defaultExpanded={false}
                      parameters={{ argv: ["pnpm", "test"] }}
                      exitCode={0}
                      output={
                        "✓ tests/shared/review-contracts.test.ts (4 tests)\nTest Files  1 passed (1)\nTests  4 passed (4)"
                      }
                    />

                    <ToolDisclosure
                      toolName="run_command"
                      target="node scripts/check-syntax.mjs"
                      status="failed"
                      durationMs={310}
                      defaultExpanded={true}
                      parameters={{
                        argv: ["node", "scripts/check-syntax.mjs"],
                      }}
                      exitCode={1}
                      error={"SyntaxError: Unexpected token '?' at line 42:15"}
                      output={""}
                    />

                    <ToolDisclosure
                      toolName="write_file"
                      target="src/shared/version.ts"
                      status="completed"
                      durationMs={24}
                      parameters={{
                        path: "src/shared/version.ts",
                        content: 'export const VERSION = "0.1.0";',
                      }}
                      output={null}
                    />

                    <ToolDisclosure
                      toolName="list_files"
                      target="src/**/*.ts"
                      status="completed"
                      durationMs={85}
                      truncated={true}
                      parameters={{ path: "src", recursive: true }}
                      output={
                        "src/renderer/main.tsx\nsrc/renderer/index.html\n... (更多 140 个文件)"
                      }
                    />
                  </div>
                </section>
              </div>
            )}

            {/* TAB 6: Code Block & Diff Preview */}
            {activeTab === "code" && (
              <div className="showcase-col">
                <section className="showcase-section">
                  <div className="showcase-section-header">
                    <h2 className="showcase-section-title">
                      <span>代码块与差异查看器 (CodeBlock & DiffViewer)</span>
                      <span className="showcase-badge">示例数据</span>
                    </h2>
                    <p className="showcase-section-desc">
                      纯只读无害示例代码，行号、一键复制、横向无溢出滚动；差异查看器区分建议差异与已应用差异，带
                      + / - 显式标记。
                    </p>
                  </div>

                  <div className="showcase-col">
                    <h3
                      style={{
                        fontSize: "var(--text-base)",
                        fontWeight: 600,
                      }}
                    >
                      只读代码块 (含行号与复制功能)
                    </h3>
                    <CodeBlock
                      code={SAMPLE_CODE}
                      fileName="src/utils/format.ts"
                      language="typescript"
                    />

                    <h3
                      style={{
                        fontSize: "var(--text-base)",
                        fontWeight: 600,
                        marginTop: "16px",
                      }}
                    >
                      建议差异预览 (Suggested Diff)
                    </h3>
                    <DiffViewer
                      change={SAMPLE_FILE_CHANGE}
                      isSuggested={true}
                    />

                    <h3
                      style={{
                        fontSize: "var(--text-base)",
                        fontWeight: 600,
                        marginTop: "16px",
                      }}
                    >
                      已截断差异提示示例
                    </h3>
                    <DiffViewer
                      change={SAMPLE_TRUNCATED_FILE_CHANGE}
                      isSuggested={false}
                    />
                  </div>
                </section>
              </div>
            )}

            {/* TAB 7: Approval & Permissions */}
            {activeTab === "approval" && (
              <div className="showcase-col">
                <section className="showcase-section">
                  <div className="showcase-section-header">
                    <h2 className="showcase-section-title">
                      <span>操作审批与安全提示面板 (ApprovalPanel)</span>
                      <span className="showcase-badge">示例数据</span>
                    </h2>
                    <p className="showcase-section-desc">
                      待批准呈现琥珀色，完整显示命令、目录及必要风险；防重复提交，支持失效状态。命令不完整禁止批准。
                    </p>
                  </div>

                  <div className="showcase-col">
                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                      }}
                    >
                      交互式审批流程演示
                    </span>

                    {approvalStatus === "approved" && (
                      <div
                        style={{
                          padding: "12px",
                          background: "var(--success-bg)",
                          color: "var(--success)",
                          borderRadius: "var(--radius-sm)",
                        }}
                      >
                        <CheckCircle
                          size={16}
                          weight="bold"
                          style={{
                            display: "inline-block",
                            verticalAlign: "middle",
                            marginRight: "6px",
                          }}
                        />
                        已批准本次执行。
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setApprovalStatus("pending")}
                          style={{ marginLeft: "12px" }}
                        >
                          重置演示
                        </Button>
                      </div>
                    )}

                    {approvalStatus === "rejected" && (
                      <div
                        style={{
                          padding: "12px",
                          background: "var(--error-bg)",
                          color: "var(--error)",
                          borderRadius: "var(--radius-sm)",
                        }}
                      >
                        <WarningCircle
                          size={16}
                          weight="bold"
                          style={{
                            display: "inline-block",
                            verticalAlign: "middle",
                            marginRight: "6px",
                          }}
                        />
                        用户已拒绝本次执行。
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setApprovalStatus("pending")}
                          style={{ marginLeft: "12px" }}
                        >
                          重置演示
                        </Button>
                      </div>
                    )}

                    {(approvalStatus === "pending" ||
                      approvalStatus === "submitting") && (
                      <ApprovalPanel
                        toolName="run_command"
                        description="任务请求在工作区根目录下执行测试套件以校验变更结果。"
                        command={["pnpm", "test", "--run"]}
                        cwd="/home/ling/services/desktop-harness"
                        riskNotice="执行本地脚本可能产生网络或文件系统副作用"
                        isSubmitting={approvalStatus === "submitting"}
                        onApprove={() => {
                          setApprovalStatus("submitting");
                          setTimeout(() => setApprovalStatus("approved"), 800);
                        }}
                        onReject={() => setApprovalStatus("rejected")}
                      />
                    )}

                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        marginTop: "16px",
                      }}
                    >
                      失效审批提示 (Invalid State)
                    </span>
                    <ApprovalPanel
                      toolName="write_file"
                      description="向已关闭的旧会话写入更新。"
                      targetPath="src/renderer/main.tsx"
                      isInvalid={true}
                      onApprove={() => {}}
                      onReject={() => {}}
                    />

                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        marginTop: "16px",
                      }}
                    >
                      命令不完整禁止批准 (Incomplete Command Protection)
                    </span>
                    <ApprovalPanel
                      toolName="run_command"
                      description="模型调用缺失完整命令行参数。"
                      command=""
                      onApprove={() => {}}
                      onReject={() => {}}
                    />
                  </div>
                </section>
              </div>
            )}

            {/* TAB 8: Layout & Panels */}
            {activeTab === "layout" && (
              <div className="showcase-col">
                <section className="showcase-section">
                  <div className="showcase-section-header">
                    <h2 className="showcase-section-title">
                      <span>
                        支持窗格架构演示 (Split & Supporting Pane Layout)
                      </span>
                      <span className="showcase-badge">示例数据</span>
                    </h2>
                    <p className="showcase-section-desc">
                      符合 DESIGN.md 的 scroll-body-shell 与 supporting-pane
                      原则：外壳固定，正文独立纵向滚动，右侧检查面板独立滚动，Prose
                      控制在 45-75 字符度量。
                    </p>
                  </div>

                  <div
                    style={{
                      height: "420px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-md)",
                      overflow: "hidden",
                    }}
                  >
                    <PanelSplit
                      sidebar={
                        <div
                          style={{
                            padding: "var(--space-3)",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "var(--text-xs)",
                              fontWeight: 600,
                              color: "var(--text-secondary)",
                            }}
                          >
                            会话列表 (232px)
                          </span>
                          <div
                            style={{
                              padding: "6px 10px",
                              background: "var(--neutral-3)",
                              borderRadius: "var(--radius-sm)",
                              fontSize: "var(--text-sm)",
                            }}
                          >
                            当前任务会话
                          </div>
                          <div
                            style={{
                              padding: "6px 10px",
                              borderRadius: "var(--radius-sm)",
                              fontSize: "var(--text-sm)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            设计原语评审记录
                          </div>
                          <div
                            style={{
                              padding: "6px 10px",
                              borderRadius: "var(--radius-sm)",
                              fontSize: "var(--text-sm)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            CI 自动化构建排查
                          </div>
                        </div>
                      }
                      main={
                        <div
                          className="prose-container"
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "16px",
                          }}
                        >
                          <h3 style={{ fontSize: "var(--text-lg)" }}>
                            主任务记录区 (Prose 宽度控制)
                          </h3>
                          <p
                            style={{
                              color: "var(--text-secondary)",
                              lineHeight: "var(--leading-base)",
                            }}
                          >
                            这里是任务主记录区。外壳保持固定，正文拥有独立滚动条，不让页面整体出现纵向滚动。当视口处于
                            1440px 或 1920px 宽度时，正文保持最佳阅读列宽。
                          </p>
                          <ToolDisclosure
                            toolName="read_file"
                            target="src/renderer/main.tsx"
                            status="completed"
                            durationMs={12}
                            output={"// 主入口已就绪"}
                          />
                        </div>
                      }
                      inspector={
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "12px",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "var(--text-xs)",
                              fontWeight: 600,
                              color: "var(--text-secondary)",
                            }}
                          >
                            检查区 / 证据面板 (360px)
                          </span>
                          <div
                            style={{
                              padding: "10px",
                              background: "var(--neutral-2)",
                              borderRadius: "var(--radius-sm)",
                              fontSize: "var(--text-xs)",
                            }}
                          >
                            <strong>当前工作区：</strong>
                            <div
                              style={{
                                fontFamily: "var(--font-mono)",
                                marginTop: "4px",
                              }}
                            >
                              /home/ling/services/desktop-harness
                            </div>
                          </div>
                          <DiffViewer
                            change={SAMPLE_PACKAGE_FILE_CHANGE}
                            isSuggested={true}
                          />
                        </div>
                      }
                    />
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
