import { Check, Copy } from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { Button } from "./Button";
import "./code-diff.css";

export interface CodeBlockProps {
  readonly code: string;
  readonly language?: string;
  readonly fileName?: string;
  readonly showLineNumbers?: boolean;
  readonly className?: string;
}

export function CodeBlock({
  code,
  language = "typescript",
  fileName,
  showLineNumbers = true,
  className = "",
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

  const lines = code.split("\n");

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
        <Button
          variant="ghost"
          size="sm"
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
      <div className="code-block-scroll">
        <div className="code-block-table">
          {lines.map((line, index) => {
            const lineNum = index + 1;
            return (
              <div key={lineNum} className="code-line">
                {showLineNumbers && (
                  <span className="code-line-number">{lineNum}</span>
                )}
                <span className="code-line-content">{line || " "}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
