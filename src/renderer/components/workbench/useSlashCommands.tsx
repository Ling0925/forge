import { useEffect, useState, type RefObject, type KeyboardEvent } from "react";
import "./slash-menu.css";

const commands = [
  { name: "/help", description: "查看桌面命令帮助" },
  { name: "/new", description: "打开新会话，保留其他会话草稿" },
  { name: "/model", description: "打开模型选择器" },
  { name: "/mode", description: "选择 Build / Plan 模式（下一次运行）" },
  { name: "/permission", description: "打开权限选择器，不自动提升权限" },
  { name: "/settings", description: "打开设置" },
  { name: "/stop", description: "停止当前会话运行" },
] as const;

export function useSlashCommands(options: {
  prompt: string;
  draftId: string;
  input: RefObject<HTMLTextAreaElement | null>;
  setPrompt: (value: string) => void;
  openNew: () => void;
  openSettings: () => void;
  stop: () => Promise<void>;
  running: boolean;
  busy: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState("");
  const text = options.prompt.trim();
  // A leading slash is reserved for local commands. // explicitly sends literal text.
  const isCommand = text.startsWith("/") && !text.startsWith("//");
  const matches = commands.filter(command => command.name.startsWith(text.toLowerCase()))
    .sort((a, b) => Number(b.name === text.toLowerCase()) - Number(a.name === text.toLowerCase()));
  const open = isCommand && !dismissed && matches.length > 0;
  const index = Math.min(selected, Math.max(0, matches.length - 1));
  const menuId = `slash-${options.draftId}`;
  useEffect(() => {
    setDismissed(false);
    setSelected(0);
    setMessage("");
  }, [options.prompt, options.draftId]);
  useEffect(() => {
    if (open) document.getElementById(`${menuId}-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [open, index, menuId]);

  const execute = async (value = text) => {
    if (!isCommand) return false;
    if (options.busy) return true;
    const command = commands.find(item => item.name === value.toLowerCase());
    if (!command) {
      setMessage("未知命令或不支持的参数。输入 / 查看命令；发送以 / 开头的普通消息请使用 //。");
      setDismissed(true);
      return true;
    }
    if (command.name === "/help") {
      setMessage(commands.map(item => `${item.name}：${item.description}`).join("\n"));
      setDismissed(true);
      return true;
    }
    const selectors: Record<string, string> = {
      "/model": ".composer-model-picker > summary",
      "/mode": 'button[aria-label="运行模式"]',
      "/permission": 'button[aria-label="执行权限"]',
    };
    const selector = selectors[command.name];
    if (selector) {
      const trigger = options.input.current?.closest("form")?.querySelector<HTMLElement>(selector);
      if (!trigger || trigger.matches(":disabled")) {
        setMessage("此操作当前不可用，请等待发送完成或切换到 Build 模式。");
        setDismissed(true);
        return true;
      }
      options.setPrompt("");
      trigger.focus();
      trigger.click();
    } else if (command.name === "/stop") {
      if (!options.running) {
        setMessage("当前会话没有正在执行的任务。");
        setDismissed(true);
        return true;
      }
      options.setPrompt("");
      await options.stop();
    } else {
      options.setPrompt("");
      if (command.name === "/new") options.openNew();
      else options.openSettings();
    }
    return true;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
    const choice = matches[index];
    if (open && choice && ["ArrowDown", "ArrowUp", "Escape", "Tab", "Enter"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Escape") setDismissed(true);
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") setSelected((index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
      else if (event.key === "Tab") options.setPrompt(choice.name);
      else void execute(choice.name);
      return true;
    }
    if (isCommand && event.key === "Enter") {
      event.preventDefault();
      void execute();
      return true;
    }
    return false;
  };
  return {
    isCommand, execute, onKeyDown,
    inputProps: {
      "aria-controls": open ? menuId : undefined,
      "aria-expanded": open,
      "aria-haspopup": "listbox" as const,
      "aria-activedescendant": open ? `${menuId}-${index}` : undefined,
      onBlur: () => setDismissed(true),
      onFocus: () => setDismissed(false),
    },
    view: <>
      {open && <div className="composer-slash-menu" id={menuId} role="listbox" aria-label="桌面命令">
        {matches.map((command, position) => <div
          key={command.name} id={`${menuId}-${position}`} role="option"
          aria-selected={position === index}
          onMouseDown={event => event.preventDefault()}
          onClick={() => void execute(command.name)}
        ><strong>{command.name}</strong><span>{command.description}</span></div>)}
        <small>↑↓ 选择 · Enter 执行 · Tab 补全 · Esc 关闭</small>
      </div>}
      {message && <output className="composer-slash-message" aria-live="polite">{message}</output>}
    </>,
  };
}
