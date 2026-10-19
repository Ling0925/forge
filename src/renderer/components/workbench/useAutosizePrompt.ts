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
        if (input.style.height !== "36px") input.style.height = "36px";
        if (input.style.overflowY !== "hidden") input.style.overflowY = "hidden";
        return;
      }
      const style = getComputedStyle(input);
      const padding =
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom);
      const line = Number.parseFloat(style.lineHeight) || 24;
      const limit = line * 6 + padding;
      const currentHeight = input.getBoundingClientRect().height;

      let targetHeight: number;
      if (input.scrollHeight > currentHeight) {
        targetHeight = Math.max(36, Math.min(input.scrollHeight, limit));
      } else {
        const prevHeight = input.style.height;
        input.style.height = "auto";
        targetHeight = Math.max(36, Math.min(input.scrollHeight, limit));
        input.style.height = prevHeight;
      }

      const nextHeightStr = `${targetHeight}px`;
      if (input.style.height !== nextHeightStr) {
        input.style.height = nextHeightStr;
      }
      const nextOverflow = input.scrollHeight > targetHeight ? "auto" : "hidden";
      if (input.style.overflowY !== nextOverflow) {
        input.style.overflowY = nextOverflow;
      }
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
