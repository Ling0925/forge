import { useEffect, useState } from "react";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { Markdown } from "./Markdown";

/** Only reasoning text actually returned by the provider is shown. */
export function Reasoning({
  text,
  live = false,
  truncated = false,
}: {
  readonly text: string;
  readonly live?: boolean;
  readonly truncated?: boolean;
}) {
  const [open, setOpen] = useState(live);
  useEffect(() => {
    if (!live) setOpen(false);
  }, [live]);
  if (!text) return null;
  return (
    <details
      className="transcript-reasoning"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{live ? "思考中…" : "思考过程"}</summary>
      <div className="transcript-reasoning-body">
        {truncated && <p className="wb-muted">思考预览已达显示上限，内容可能不完整。</p>}
        {live ? <StreamingMarkdown source={text} /> : <Markdown source={text} />}
      </div>
    </details>
  );
}
