import { describe, expect, it } from "vitest";
import { getReaderSnoozePresets } from "./reader-snooze";

describe("getReaderSnoozePresets", () => {
  it("offers afternoon, tomorrow, weekend and next week on a weekday morning", () => {
    const presets = getReaderSnoozePresets(new Date(2026, 8, 30, 8, 0));
    expect(presets.map((preset) => preset.id)).toEqual([
      "this-afternoon",
      "tomorrow-morning",
      "this-weekend",
      "next-week",
    ]);
  });

  it("drops presets already in the past", () => {
    const presets = getReaderSnoozePresets(new Date(2026, 8, 30, 18, 0));
    expect(presets.map((preset) => preset.id)).toEqual([
      "tomorrow-morning",
      "this-weekend",
      "next-week",
    ]);
  });
});
