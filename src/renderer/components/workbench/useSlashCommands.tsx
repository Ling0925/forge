import { useEffect, useRef, useState, type RefObject, type KeyboardEvent } from "react";
import { matchSlashCommands } from "../../../shared/slash-commands";
import { desktopSlashLimitation, executeDesktopSlash, type DesktopSlashHost, type DesktopSlashResult } from "./desktop-slash";
import "./slash-menu.css";

export function useSlashCommands(options: {
  prompt: string;
  draftId: string;
  input: RefObject<HTMLTextAreaElement | null>;
  setPrompt: (value: string) => void;
  host: DesktopSlashHost;
  busy: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [selected, setSelected] = useState(0);
  const [result, setResult] = useState<DesktopSlashResult>({});
  const [executing, setExecuting] = useState(false);
  const locked = useRef(false);
  const currentDraft = useRef(options.draftId);
  currentDraft.current = options.draftId;
  const text = options.prompt.trim();
  const isCommand = options.prompt.startsWith("/");
  const matches = matchSlashCommands(text).sort((a, b) => Number(b.name === text) - Number(a.name === text));
  const open = isCommand && !dismissed && !/\s/.test(text) && matches.length > 0;
  const index = Math.min(selected, Math.max(0, matches.length - 1));
  const menuId = `slash-${options.draftId}`;
  useEffect(() => { setDismissed(false); setSelected(0); }, [options.prompt, options.draftId]);
  useEffect(() => { setResult({}); }, [options.draftId]);
  useEffect(() => {
    if (open) document.getElementById(`${menuId}-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [open, index, menuId]);

  const execute = async (line = text) => {
    if (!isCommand) return false;
    if (options.busy || locked.current) return true;
    locked.current = true;
    setExecuting(true);
    setDismissed(true);
    try {
      const next = await executeDesktopSlash(line, options.host);
      if (currentDraft.current === options.draftId) {
        setResult(next);
        if (next.clearPrompt) options.setPrompt("");
      }
    } catch (error) {
      if (currentDraft.current === options.draftId) setResult({ text: error instanceof Error ? error.message : "命令执行失败，未自动重试。" });
    } finally {
      locked.current = false;
      setExecuting(false);
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
    isCommand, execute, onKeyDown, executing,
    inputProps: {
      "aria-controls": open ? menuId : undefined,
      "aria-expanded": open,
      "aria-haspopup": "listbox" as const,
      "aria-activedescendant": open ? `${menuId}-${index}` : undefined,
      onBlur: () => setDismissed(true),
      onFocus: () => setDismissed(false),
    },
    view: <>
      {open && <div className="composer-slash-menu" id={menuId} role="listbox" aria-label="Forge 命令">
        {matches.map((command, position) => <div
          key={command.name} id={`${menuId}-${position}`} role="option"
          aria-selected={position === index}
          onMouseDown={event => event.preventDefault()}
          onClick={() => void execute(command.name)}
        ><strong>{command.name}</strong><span>{command.args} {command.description}
          {desktopSlashLimitation(command.name) && <small>{desktopSlashLimitation(command.name)}</small>}
        </span></div>)}
        <small>↑↓ 选择 · Enter 执行 · Tab 补全 · Esc 关闭</small>
      </div>}
      {executing && <output aria-live="polite">正在执行命令…</output>}
      {result.text && <output className="composer-slash-message" aria-live="polite">{result.text}</output>}
      {result.sessions?.map(session => <button key={session.id} type="button" disabled={executing}
        onClick={() => void execute(`/resume ${session.id}`)}>{session.title} · {session.id}</button>)}
    </>,
  };
}
