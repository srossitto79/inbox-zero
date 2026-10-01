import { describe, expect, it } from "vitest";
import { getSwipeNavigation } from "@/app/(app)/[emailAccountId]/mail/reader-swipe";

describe("getSwipeNavigation", () => {
  it("treats a right-to-left drag as next", () => {
    expect(
      getSwipeNavigation({ startX: 200, startY: 100, endX: 100, endY: 100 }),
    ).toBe("next");
  });

  it("treats a left-to-right drag as previous", () => {
    expect(
      getSwipeNavigation({ startX: 100, startY: 100, endX: 200, endY: 100 }),
    ).toBe("previous");
  });

  it("ignores a tap or a short drag", () => {
    expect(
      getSwipeNavigation({ startX: 100, startY: 100, endX: 120, endY: 100 }),
    ).toBeNull();
  });

  it("ignores a vertical scroll that drifts sideways", () => {
    expect(
      getSwipeNavigation({ startX: 100, startY: 100, endX: 130, endY: 400 }),
    ).toBeNull();
  });

  it("counts a diagonal drag that is mostly horizontal", () => {
    expect(
      getSwipeNavigation({ startX: 200, startY: 100, endX: 80, endY: 130 }),
    ).toBe("next");
  });
});
