import { MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import {
  afterModalsClosed,
  findOpenModalDialog,
} from "../../state/modal-shortcuts";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { Input } from "../primitives/Input";
import { Dialog } from "./Dialog";

export function CommandPalette() {
  const {
    state,
    selectSession,
    openSettings,
    openNewSession,
    refreshActiveSession,
  } = useWorkbench();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const selectedButton = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && selected >= 0)
      selectedButton.current
        ?.querySelector('[aria-current="true"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [selected, open]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !event.isComposing
      ) {
        event.preventDefault();
        // Ctrl/Cmd+K toggles the palette itself, but must never stack it on
        // top of another open dialog (settings, new task, or a local panel).
        if (!open && findOpenModalDialog()) return;
        setOpen((value) => !value);
        setQuery("");
        setSelected(0);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);
  const actions = [
    { id: "new", label: "新建任务", run: () => openNewSession(true) },
    { id: "settings", label: "打开设置", run: () => openSettings(true) },
    ...(state.activeSessionId
      ? [
          {
            id: "refresh",
            label: "刷新当前会话",
            run: () => void refreshActiveSession(),
          },
        ]
      : []),
    ...state.sessions.map((session) => ({
      id: session.id,
      label: `打开会话 · ${session.title}${session.archived ? "（已归档）" : ""}`,
      run: () => void selectSession(session.id),
    })),
  ].filter((action) =>
    action.label.toLowerCase().includes(query.toLowerCase()),
  );
  const execute = (index: number) => {
    const action = actions[index];
    if (!action) return;
    setOpen(false);
    // Close and restore the source focus before handing off to another modal.
    afterModalsClosed(() => action.run());
  };
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="command-palette-trigger"
        aria-label="命令 · Ctrl/Cmd K"
        title="命令 · Ctrl/Cmd K"
        onClick={() => {
          setOpen(true);
          setQuery("");
          setSelected(0);
        }}
      >
        <MagnifyingGlass size={16} aria-hidden="true" />
        <span className="command-palette-trigger-label">命令</span>
      </Button>
      <Dialog
        open={open}
        title="命令与会话导航"
        initialFocus="#command-search"
        onClose={() => setOpen(false)}
      >
        <div className="modal-content wb-stack command-palette">
          <Input
            id="command-search"
            aria-label="搜索命令或会话"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((old) =>
                  Math.max(
                    0,
                    Math.min(
                      actions.length - 1,
                      old + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
              }
              if (event.key === "Enter") {
                event.preventDefault();
                execute(selected);
              }
            }}
          />
          <p
            className="wb-muted command-selection"
            aria-live="polite"
            title={actions[selected]?.label}
          >
            ↑ ↓ 选择 · Enter 执行 · {actions[selected]?.label ?? "没有匹配命令"}
          </p>
          <div ref={selectedButton} className="command-list wb-stack">
            {actions.map((action, index) => (
              <Button
                className="command-action"
                title={action.label}
                aria-label={action.label}
                aria-current={selected === index ? "true" : undefined}
                key={action.id}
                variant={selected === index ? "primary" : "secondary"}
                onClick={() => execute(index)}
              >
                <span className="command-action-label">{action.label}</span>
              </Button>
            ))}
          </div>
        </div>
      </Dialog>
    </>
  );
}
