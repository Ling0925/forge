import { type RefObject, useLayoutEffect } from "react";

export function useAutosizePrompt(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input || input.value !== value) return;
    const resize = () => {
      if (!input.value) {
        input.style.height = "36px";
        input.style.overflowY = "hidden";
        return;
      }
      const style = getComputedStyle(input);
      const padding =
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom);
      const line = Number.parseFloat(style.lineHeight);
      const limit = line * 6 + padding;
      input.style.height = "0px";
      const height = Math.max(36, Math.min(input.scrollHeight, limit));
      input.style.height = `${height}px`;
      input.style.overflowY = input.scrollHeight > height ? "auto" : "hidden";
    };
    resize();
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth === width) return;
      width = input.clientWidth;
      resize();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [ref, value]);
}
