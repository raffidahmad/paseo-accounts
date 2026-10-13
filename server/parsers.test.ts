import { describe, expect, it } from "vitest";
import { parseUsage } from "./claude";
import { parseRateLimits } from "./codex";

describe("Claude usage", () => {
  it("reads the subscription windows and model-scoped weekly limits", () => {
    const windows = parseUsage({
      five_hour: { utilization: 49, resets_at: "2026-09-23T08:00:00.599646+00:00" },
      seven_day: { utilization: 74, resets_at: "2026-09-25T10:00:00.599667+00:00" },
      seven_day_opus: null,
      limits: [{ kind: "weekly_scoped", percent: 21, resets_at: "2026-09-25T10:00:00Z", scope: { model: { display_name: "Fable" } } }],
    });
    expect(windows).toEqual([
      { id: "five_hour", label: "5-hour", usedPercent: 49, resetsAt: "2026-09-23T08:00:00.599Z" },
      { id: "seven_day", label: "Weekly", usedPercent: 74, resetsAt: "2026-09-25T10:00:00.599Z" },
      { id: "weekly_fable", label: "Weekly · Fable", usedPercent: 21, resetsAt: "2026-09-25T10:00:00.000Z" },
    ]);
  });

  it("tolerates missing or malformed data", () => {
    expect(parseUsage(null)).toEqual([]);
    expect(parseUsage({ five_hour: { utilization: null } })).toEqual([]);
  });
});

describe("Codex rate limits", () => {
  it("labels windows by their length and converts reset times", () => {
    expect(
      parseRateLimits({
        primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1790150000 },
        secondary: { usedPercent: 84, windowDurationMins: 10080, resetsAt: 1790500000 },
      }),
    ).toEqual([
      { id: "primary", label: "5-hour", usedPercent: 42, resetsAt: new Date(1790150000 * 1000).toISOString() },
      { id: "secondary", label: "Weekly", usedPercent: 84, resetsAt: new Date(1790500000 * 1000).toISOString() },
    ]);
    expect(parseRateLimits({ primary: null, secondary: { usedPercent: 5, windowDurationMins: null, resetsAt: null } })).toEqual([
      { id: "secondary", label: "Usage", usedPercent: 5, resetsAt: null },
    ]);
  });
});
