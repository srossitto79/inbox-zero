import { describe, expect, it } from "vitest";
import {
  downloadRatePerMinute,
  downloadRemainingMinutes,
  formatDuration,
  pushDownloadSample,
} from "@/utils/mail-engine/download-progress";

describe("download progress", () => {
  it("derives a rate only once the samples span enough time", () => {
    let samples = pushDownloadSample([], { at: 0, count: 100 });
    samples = pushDownloadSample(samples, { at: 10_000, count: 110 });
    expect(downloadRatePerMinute(samples)).toBeNull();
    samples = pushDownloadSample(samples, { at: 60_000, count: 160 });
    expect(downloadRatePerMinute(samples)).toBeCloseTo(60);
  });

  it("reports no estimate when nothing is arriving", () => {
    const samples = [
      { at: 0, count: 50 },
      { at: 120_000, count: 50 },
    ];
    expect(downloadRatePerMinute(samples)).toBeNull();
    expect(downloadRemainingMinutes(1000, null)).toBeNull();
  });

  it("drops samples older than the window", () => {
    let samples = pushDownloadSample([], { at: 0, count: 1 });
    samples = pushDownloadSample(samples, { at: 11 * 60_000, count: 2 });
    expect(samples).toEqual([{ at: 11 * 60_000, count: 2 }]);
  });

  it("formats durations", () => {
    expect(formatDuration(42)).toBe("42 min");
    expect(formatDuration(135)).toBe("2 h 15 min");
    expect(formatDuration(60 * 72)).toBe("3 days");
  });
});
