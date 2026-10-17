import type { HtmlPreviewResponse } from "../../shared/html-preview";

export type HtmlPreviewSource =
  | { readonly kind: "inline"; readonly html: string }
  | { readonly kind: "file"; readonly path: string };

/**
 * HTML preview needs a real HTTP document URL: `srcdoc`, `blob:` and `data:`
 * frames are refused by the workbench CSP, and the desktop host has no
 * authenticated preview endpoint. The capability is therefore probed on the
 * host bridge instead of assumed from the platform.
 */
export function htmlPreviewAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const forge: Partial<Window["forge"]> | undefined = window.forge;
  return (
    typeof forge?.previewHtml === "function" &&
    typeof forge?.previewFile === "function"
  );
}

export async function loadHtmlPreview(
  source: HtmlPreviewSource,
): Promise<HtmlPreviewResponse> {
  const forge = typeof window === "undefined" ? undefined : window.forge;
  if (!forge) throw new Error("HTML 预览不可用。");
  if (source.kind === "inline") {
    if (typeof forge.previewHtml !== "function")
      throw new Error("HTML 预览不可用。");
    return forge.previewHtml(source.html);
  }
  if (typeof forge.previewFile !== "function")
    throw new Error("HTML 预览不可用。");
  return forge.previewFile(source.path);
}
