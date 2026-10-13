import { join } from "node:path";
import { UsageSchema, type Usage } from "../shared/model";
import { readJson, writeJsonAtomic } from "./json-file";
import { dataDir } from "./paths";

/** How long to wait after the provider asks us to slow down (HTTP 429), from its `Retry-After`. */
export function retryDelayMs(retryAfter: string | null, now: number = Date.now()): number {
  const fallback = 2 * 60_000;
  if (!retryAfter) return fallback;
  const seconds = Number(retryAfter);
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(retryAfter) - now;
  if (!Number.isFinite(ms)) return fallback;
  return Math.min(30 * 60_000, Math.max(30_000, ms));
}

/**
 * The reading to show after a refresh. A failed or rate-limited refresh keeps the last windows, and
 * the CLI's own cached copy only replaces a reading it is newer than.
 */
export function mergeUsage(previous: Usage | undefined, next: Usage): Usage {
  if (!previous || previous.windows.length === 0) return next;
  if (next.windows.length === 0) return { ...previous, error: next.error };
  if (next.cached && Date.parse(next.fetchedAt) <= Date.parse(previous.fetchedAt)) return previous;
  return next;
}

function usagePath(): string {
  return join(dataDir(), "usage.json");
}

/** Each account's last reading, as `saveReadings` left it, so a reload never blanks the cards. */
export async function loadReadings(): Promise<Map<string, Usage>> {
  const readings = new Map<string, Usage>();
  const saved = await readJson(usagePath()).catch(() => undefined);
  if (!saved || typeof saved !== "object") return readings;
  for (const [accountId, value] of Object.entries(saved)) {
    const parsed = UsageSchema.safeParse(value);
    if (parsed.success) readings.set(accountId, parsed.data);
  }
  return readings;
}

export function saveReadings(readings: ReadonlyMap<string, Usage>): Promise<void> {
  return writeJsonAtomic(usagePath(), Object.fromEntries(readings));
}
