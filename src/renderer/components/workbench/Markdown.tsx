import { Component, type ReactNode, memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isHtmlLanguage } from "../../../shared/html-preview";
import { externalUrlSchema } from "../../../shared/ipc";
import { CodeBlock } from "../primitives/CodeBlock";

// Bound parsing work, not displayed content. Large messages remain complete,
// selectable plain text; source and persisted transcript are never truncated.
export const MARKDOWN_PARSE_LIMIT = 100000;
const plugins = [remarkGfm];

function PlainMarkdown({ source }: { readonly source: string }) {
  return <pre className="message-body markdown-plain">{source}</pre>;
}

class MarkdownBoundary extends Component<
  { readonly source: string; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidUpdate(previous: { readonly source: string }) {
    if (this.state.failed && previous.source !== this.props.source)
      this.setState({ failed: false });
  }
  override render() {
    return this.state.failed ? (
      <PlainMarkdown source={this.props.source} />
    ) : (
      this.props.children
    );
  }
}

function components(highlight: boolean): Components {
  return {
    a: ({ children, href }) => {
      const safe = externalUrlSchema.safeParse(href);
      if (!safe.success) return <span>{children}</span>;
      const open = (event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        if (event.type === "auxclick" && event.button !== 1) return;
        void window.forge.openExternal(safe.data).catch(() => {
          // The host remains authoritative and may refuse the URL.
        });
      };
      return (
        <a
          href={safe.data}
          onClick={open}
          onAuxClick={open}
          rel="noreferrer noopener"
        >
          {children}
        </a>
      );
    },
    // Never fetch model-supplied images; expose their description as text.
    img: ({ alt }) => <span>{alt ? `[图片：${alt}]` : "[图片]"}</span>,
    pre: ({ children, node }) => {
      const codeNode = node?.children.find(
        (child) => child.type === "element" && child.tagName === "code",
      );
      if (!codeNode || codeNode.type !== "element")
        return <pre>{children}</pre>;
      const code = codeNode.children
        .map((child) => (child.type === "text" ? child.value : ""))
        .join("")
        .replace(/\n$/, "");
      const classes = codeNode.properties.className;
      const language =
        /(?:^|\s)language-([^\s]+)/.exec(
          Array.isArray(classes) ? classes.join(" ") : String(classes ?? ""),
        )?.[1] ?? "text";
      return (
        <div className="markdown-code">
          <CodeBlock
            code={code}
            language={language}
            highlight={highlight}
            // A streamed block (highlight disabled) is still changing, so it
            // offers no preview; a settled block offers one when the host has
            // a preview endpoint. The host probe decides the rest.
            previewHtml={highlight && isHtmlLanguage(language)}
          />
        </div>
      );
    },
    code: ({ children }) => <code>{children}</code>,
    table: ({ children }) => (
      <div className="markdown-table-scroll">
        <table>{children}</table>
      </div>
    ),
  };
}

/** HTML is skipped, resources never fetched, and links use the validated host bridge. */
export const Markdown = memo(function Markdown({
  source,
  highlight = true,
}: {
  readonly source: string;
  readonly highlight?: boolean;
}) {
  const renderers = useMemo(() => components(highlight), [highlight]);
  return (
    <div className="markdown-content message-prose">
      <MarkdownBoundary source={source}>
        {source.length > MARKDOWN_PARSE_LIMIT ? (
          <>
            <p className="wb-muted">长消息以纯文本显示，内容完整保留。</p>
            <PlainMarkdown source={source} />
          </>
        ) : (
          <ReactMarkdown
            remarkPlugins={plugins}
            skipHtml
            components={renderers}
          >
            {source}
          </ReactMarkdown>
        )}
      </MarkdownBoundary>
    </div>
  );
});
