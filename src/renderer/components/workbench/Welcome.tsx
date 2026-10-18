import { isPrimarySession } from "../../../shared/sessions";
import { useWorkbench } from "../../state/workbench-context";

export function Welcome() {
  const { state } = useWorkbench();
  const sessions = state.sessions.filter((session) => isPrimarySession(session) && !session.archived);
  const workspaces = new Set(sessions.map((session) => session.workspace));
  const loading = state.isSessionsLoading;

  return (
    <section className="wb-new-session-intro" aria-labelledby="welcome-title">
      <div className="welcome-heading">
        <span className="welcome-mark" aria-hidden="true">
          f.
        </span>
        <h2 id="welcome-title">今天，想做点什么？</h2>
      </div>
      <p>从一个想法开始，让 Forge 和你一起完成。</p>
      <section className="welcome-overview" aria-label="工作台概览">
        <div className="welcome-overview-heading">
          <h3>你的工作台</h3>
          <span>本地会话</span>
        </div>
        <dl className="welcome-metrics">
          <div>
            <dt>会话</dt>
            <dd>{loading ? "—" : sessions.length}</dd>
          </div>
          <div>
            <dt>工作区</dt>
            <dd>{loading ? "—" : workspaces.size}</dd>
          </div>
        </dl>
        <p>
          {loading
            ? "正在读取会话…"
            : sessions.length === 0
              ? "你的下一件作品，就从这里开始。"
              : "从侧栏继续之前的工作，或在下方开启新会话。"}
        </p>
      </section>
    </section>
  );
}
