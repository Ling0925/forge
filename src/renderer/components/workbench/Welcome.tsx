import { ArrowUpRight } from "@phosphor-icons/react";
import { isPrimarySession } from "../../../shared/sessions";
import { useWorkbench } from "../../state/workbench-context";

export function Welcome() {
  const { state, selectSession } = useWorkbench();
  const recent = state.sessions
    .filter((session) => isPrimarySession(session) && !session.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);

  return (
    <div className="wb-new-session-scroll" role="region" aria-label="欢迎与最近任务">
      <section className="wb-new-session-intro" aria-labelledby="welcome-title">
        <div className="welcome-heading">
          <span className="welcome-mark" aria-hidden="true">
            f.
          </span>
          <h2 id="welcome-title">今天，想做点什么？</h2>
        </div>
        <p>继续之前的工作，或开始一项新任务。</p>
        <section
          className="welcome-recent"
          aria-labelledby="recent-tasks-title"
          aria-busy={state.isSessionsLoading}
        >
          <h3 id="recent-tasks-title">最近任务</h3>
          {recent.length > 0 ? (
            <ul className="welcome-task-list">
              {recent.map((session) => (
                <li key={session.id}>
                  <button
                    className="welcome-task"
                    type="button"
                    onClick={() => void selectSession(session.id)}
                  >
                    <span className="welcome-task-content">
                      <span className="welcome-task-title">{session.title}</span>
                      <span className="welcome-task-meta">
                        <span title={session.workspace}>
                          {session.workspace
                            .replace(/[\\/]+$/, "")
                            .split(/[\\/]/)
                            .pop() || session.workspace}
                        </span>
                        <time dateTime={session.updatedAt}>
                          {new Date(session.updatedAt).toLocaleDateString(
                            "zh-CN",
                            { month: "numeric", day: "numeric" },
                          )}
                        </time>
                      </span>
                    </span>
                    <ArrowUpRight size={18} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="welcome-empty">
              {state.isSessionsLoading
                ? "正在读取最近任务…"
                : "还没有历史任务，从下方开始。"}
            </p>
          )}
        </section>
      </section>
    </div>
  );
}
