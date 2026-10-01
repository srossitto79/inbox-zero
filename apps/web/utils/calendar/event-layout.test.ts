import { describe, expect, it } from "vitest";
import { layoutDayEvents } from "./event-layout";

function place(segments: { id: string; start: number; end: number }[]) {
  return Object.fromEntries(
    layoutDayEvents(segments).map(({ id, ...placement }) => [id, placement]),
  );
}

describe("layoutDayEvents", () => {
  it("gives a lone event the full width", () => {
    expect(place([{ id: "a", start: 540, end: 600 }])).toEqual({
      a: { column: 0, columns: 1, span: 1 },
    });
  });

  it("keeps back-to-back events in the same column", () => {
    expect(
      place([
        { id: "a", start: 540, end: 600 },
        { id: "b", start: 600, end: 660 },
      ]),
    ).toEqual({
      a: { column: 0, columns: 1, span: 1 },
      b: { column: 0, columns: 1, span: 1 },
    });
  });

  it("places overlapping events side by side", () => {
    expect(
      place([
        { id: "a", start: 540, end: 660 },
        { id: "b", start: 570, end: 630 },
      ]),
    ).toEqual({
      a: { column: 0, columns: 2, span: 1 },
      b: { column: 1, columns: 2, span: 1 },
    });
  });

  it("shares a cluster across a chain of overlaps", () => {
    // a overlaps b, b overlaps c, a and c do not overlap.
    const placements = place([
      { id: "a", start: 540, end: 600 },
      { id: "b", start: 580, end: 660 },
      { id: "c", start: 640, end: 700 },
    ]);

    expect(placements.a.columns).toBe(2);
    expect(placements.b.column).toBe(1);
    expect(placements.c.column).toBe(0);
    expect(placements.c.columns).toBe(2);
  });

  it("widens an event into free columns to its right", () => {
    const placements = place([
      { id: "long", start: 540, end: 720 },
      { id: "b", start: 540, end: 600 },
      { id: "c", start: 540, end: 600 },
      { id: "d", start: 660, end: 720 },
    ]);

    expect(placements.long).toEqual({ column: 0, columns: 3, span: 1 });
    // d starts after b and c end, so it can take their columns.
    expect(placements.d.column).toBe(1);
    expect(placements.d.span).toBe(2);
  });

  it("treats a very short event as tall enough to collide", () => {
    const placements = place([
      { id: "a", start: 540, end: 545 },
      { id: "b", start: 550, end: 600 },
    ]);

    expect(placements.a.columns).toBe(2);
    expect(placements.b.column).toBe(1);
  });

  it("starts a new cluster after a gap", () => {
    const placements = place([
      { id: "a", start: 540, end: 600 },
      { id: "b", start: 560, end: 620 },
      { id: "c", start: 800, end: 860 },
    ]);

    expect(placements.a.columns).toBe(2);
    expect(placements.c).toEqual({ column: 0, columns: 1, span: 1 });
  });

  it("is stable for events with identical times", () => {
    const first = layoutDayEvents([
      { id: "b", start: 540, end: 600 },
      { id: "a", start: 540, end: 600 },
    ]);
    const second = layoutDayEvents([
      { id: "a", start: 540, end: 600 },
      { id: "b", start: 540, end: 600 },
    ]);

    expect(first).toEqual(second);
  });
});
