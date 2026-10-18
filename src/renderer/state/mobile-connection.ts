/**
 * Host detection and routing for the Android workbench shell.
 *
 * The Android WebView appends one independent token to its user agent. Only
 * that exact token marks the page as running inside the mobile shell; every
 * other browser (desktop Electron, LAN web pages, plain Chromium) keeps the
 * normal pairing panel. Matching is token-exact so `ForgeMobile/1x` or a
 * version such as `ForgeMobile/11` can never enable the mobile-only UI.
 */
export const MOBILE_USER_AGENT_TOKEN = "ForgeMobile/1";

/**
 * Same-origin main-frame route the Android shell intercepts. It is a plain
 * link target: the renderer never navigates there by itself.
 */
export const CONNECTION_SETTINGS_PATH = "/.forge-mobile/connection-settings";

const TOKEN_PATTERN = /(?:^|[\s;(])ForgeMobile\/1(?:$|[\s;)])/;

/** True when the user agent carries the standalone `ForgeMobile/1` token. */
export function hasMobileUserAgentToken(
  userAgent: string | null | undefined,
): boolean {
  if (typeof userAgent !== "string" || !userAgent) return false;
  return TOKEN_PATTERN.test(userAgent);
}

/**
 * Reads the ambient document user agent. An explicit argument is accepted so
 * the same rule can be exercised without a browser environment.
 */
export function isMobileAppHost(userAgent?: string | null): boolean {
  if (userAgent !== undefined) return hasMobileUserAgentToken(userAgent);
  if (typeof navigator === "undefined") return false;
  return hasMobileUserAgentToken(navigator.userAgent);
}

export interface ConnectionLocationLike {
  readonly origin?: string | undefined;
  readonly protocol?: string | undefined;
  readonly host?: string | undefined;
  readonly href?: string | undefined;
}

/**
 * The address shown in the read-only connection field.
 *
 * Only the origin (`scheme://host[:port]`) is reported, so credentials, paths,
 * query strings and fragments — which may carry secrets — never reach the UI.
 * When a page has an opaque origin (for example `about:blank`) the value is
 * empty instead of leaking a partial URL.
 */
export function connectionDisplayTarget(
  locationLike?: ConnectionLocationLike | null,
): string {
  const source =
    locationLike ??
    (typeof window === "undefined"
      ? null
      : (window.location as ConnectionLocationLike));
  if (!source) return "";
  const origin = typeof source.origin === "string" ? source.origin : "";
  if (origin && origin !== "null") return origin;
  const protocol = typeof source.protocol === "string" ? source.protocol : "";
  const host = typeof source.host === "string" ? source.host : "";
  if (!protocol || !host || protocol === "file:" || protocol === "about:")
    return "";
  return `${protocol}//${host}`;
}
