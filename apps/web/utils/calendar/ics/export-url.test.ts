import { describe, expect, it } from "vitest";
import { buildExportUrl } from "./export-url";

describe("buildExportUrl", () => {
  const from = new Date("2026-10-01T00:00:00.000Z");
  const to = new Date("2026-10-08T00:00:00.000Z");

  it("serializes the range without a calendar when none is given", () => {
    const url = buildExportUrl({ from, to });
    expect(url).toBe(
      `/api/user/calendar/export?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
    );
  });

  it("adds the calendar id when exporting one calendar", () => {
    const url = buildExportUrl({ from, to, calendarId: "cal-9" });
    expect(url).toContain("calendarId=cal-9");
  });

  it("is a route the export handler accepts", () => {
    // The route needs at least a range or a calendar selection.
    const params = new URLSearchParams(
      buildExportUrl({ from, to }).split("?")[1] as string,
    );
    expect(params.get("from")).toBe(from.toISOString());
    expect(params.get("to")).toBe(to.toISOString());
  });
});
