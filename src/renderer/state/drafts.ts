import { z } from "zod";
const draftsSchema = z.record(z.string().max(1000000));
/** Browser storage is untrusted and contains prompt text only, never settings or keys. */
export function parseDrafts(
  source: string | null,
): Readonly<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(source ?? "{}");
    return draftsSchema.parse(parsed);
  } catch {
    return {};
  }
}
