import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "../primitives/CodeBlock";

/** Raw HTML is never interpreted; URLs use react-markdown's safe protocol filter. */
export function Markdown({ source }: { readonly source: string }) {
  return (
    <div className="markdown-content message-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => {
                if (href) {
                  e.preventDefault();
                  void window.forge.openExternal(href).catch(() => {
                    /* host rejects unsafe URLs */
                  });
                }
              }}
            >
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <div className="markdown-code">{children}</div>
          ),
          code: ({ children, className, node }) => {
            const code = String(children).replace(/\n$/, "");
            const language = /language-([^\s]+)/.exec(className ?? "")?.[1];
            const multiline =
              (node?.position?.end.line ?? 0) >
              (node?.position?.start.line ?? 0);
            return language || multiline ? (
              <CodeBlock code={code} language={language ?? "text"} />
            ) : (
              <code>{children}</code>
            );
          },
          table: ({ children }) => (
            <div className="markdown-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
