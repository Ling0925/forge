// Compatibility surface for existing renderer imports. Accumulation itself lives
// in the shared module so the host can summarize event prefixes for paged reads.
export {
  appendSessionEvent,
  compactTokens,
  seedSessionUsage,
  sessionUsage,
  summarizeUsageState,
} from "../../shared/session-usage";
export type { SessionUsageState } from "../../shared/session-usage";
