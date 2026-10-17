import { Check, Copy } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import {
  type CodeHighlightToken,
  highlightCode,
  splitHighlightTokensIntoLines,
} from "../../state/code-highlight";
import { Button } from "./Button";
import { HtmlPreview } from "./HtmlPreview";
import "./code-diff.css";

export interface CodeBlockProps {
  readonly code: string;
  readonly language?: string;
  readonly fileName?: string;
  readonly showLineNumbers?: boolean;
  readonly highlight?: boolean;
  readonly className?: string;
  /** Offer a sandboxed HTML preview; only rendered when the host supports it. */
  readonly previewHtml?: boolean;
}

export function CodeBlock({
  code,
  language = "text",
  fileName,
  showLineNumbers = true,
  highlight = true,
  className = "",
  previewHtml = false,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is unavailable
    }
  }, [code]);

  const lines = useMemo(() => {
    if (!highlight) {
      return code
        .split("\n")
        .map((line): readonly CodeHighlightToken[] =>
          line ? [{ kind: "plain", text: line }] : [],
        );
    }
    return splitHighlightTokensIntoLines(highlightCode(code, language).tokens);
  }, [code, language, highlight]);

  return (
    <section
      className={`code-block ${className}`.trim()}
      aria-label={fileName ?? "代码块"}
    >
      <div className="code-block-header">
        <div className="code-block-meta">
          {language && <span className="code-block-lang">{language}</span>}
          {fileName && <span>{fileName}</span>}
        </div>
        <div className="code-block-actions">
          {previewHtml && (
            <HtmlPreview
              html={code}
              label="预览"
              className="code-block-preview"
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            // Present only while the confirmation check is shown: the keyframe
            // runs once on the swap and is never re-triggered by later renders.
            className={copied ? "copy-success-bounce" : ""}
            icon={
              copied ? (
                <Check size={14} weight="bold" />
              ) : (
                <Copy size={14} weight="regular" />
              )
            }
            onClick={handleCopy}
            aria-label={copied ? "已复制原文" : "复制全文"}
          >
            {copied ? "已复制" : "复制"}
          </Button>
        </div>
      </div>
      <div className="code-block-scroll">
        <div className="code-block-table">
          {lines.map((line, index) => {
            const lineNum = index + 1;
            return (
              <div key={lineNum} className="code-line">
                {showLineNumbers && (
                  <span className="code-line-number">{lineNum}</span>
                )}
                <span className="code-line-content">
                  {line.length > 0 ? renderHighlightedLine(line) : " "}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function renderHighlightedLine(line: readonly CodeHighlightToken[]) {
  let offset = 0;
  return line.map((token) => {
    const key = `${offset}:${token.kind}`;
    offset += token.text.length;
    return (
      <span key={key} className={`code-token code-token-${token.kind}`}>
        {token.text}
      </span>
    );
  });
}
