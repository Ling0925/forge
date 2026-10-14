import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";

export const MARKDOWN_STREAM_INTERVAL = 80;

/** Trailing throttle (not debounce): continuous deltas cannot starve updates.
 * The caller keys this component by session/run and unmounts at turn boundaries. */
export function StreamingMarkdown({ source }: { readonly source: string }) {
  const [displayed, setDisplayed] = useState(source);
  const latest = useRef(source);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    latest.current = source;
    if (timer.current === undefined && source !== displayed) {
      timer.current = setTimeout(() => {
        timer.current = undefined;
        setDisplayed(latest.current);
      }, MARKDOWN_STREAM_INTERVAL);
    }
  }, [source, displayed]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <Markdown source={displayed} highlight={false} />;
}
