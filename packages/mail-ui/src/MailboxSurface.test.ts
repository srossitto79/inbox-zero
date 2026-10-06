import { describe, expect, it } from "vitest";
import {
  mergeGroupSections,
  type CollapsedGroupHeader,
  type MailboxGroup,
} from "./MailboxSurface";

const group = (
  label: string,
  startIndex: number,
  items: string[],
): MailboxGroup<string> => ({ label, startIndex, items });

const header = (
  label: string,
  count: number,
  beforeIndex: number,
): CollapsedGroupHeader => ({ label, count, beforeIndex });

describe("mergeGroupSections", () => {
  it("returns just the groups when nothing is collapsed", () => {
    const sections = mergeGroupSections(
      [group("a", 0, ["1", "2"]), group("b", 2, ["3"])],
      [],
    );

    expect(sections).toEqual([
      { type: "group", group: group("a", 0, ["1", "2"]) },
      { type: "group", group: group("b", 2, ["3"]) },
    ]);
  });

  it("places a collapsed header before the group that followed it", () => {
    const sections = mergeGroupSections(
      [group("a", 0, ["1"]), group("c", 1, ["2"])],
      [header("b", 2, 1)],
    );

    expect(sections.map((section) => section.type)).toEqual([
      "group",
      "collapsedHeader",
      "group",
    ]);
    expect(sections[1]).toEqual({
      type: "collapsedHeader",
      header: header("b", 2, 1),
    });
  });

  it("leads with a collapsed header that preceded every visible row", () => {
    const sections = mergeGroupSections(
      [group("b", 0, ["1"])],
      [header("a", 3, 0)],
    );

    expect(sections.map((section) => section.type)).toEqual([
      "collapsedHeader",
      "group",
    ]);
  });

  it("keeps trailing collapsed headers after the last group", () => {
    const sections = mergeGroupSections(
      [group("a", 0, ["1"])],
      [header("b", 2, 1)],
    );

    expect(sections.map((section) => section.type)).toEqual([
      "group",
      "collapsedHeader",
    ]);
  });

  it("renders headers for every run when all groups are collapsed", () => {
    const sections = mergeGroupSections(
      [],
      [header("a", 2, 0), header("b", 1, 0)],
    );

    expect(sections.map((section) => section.type)).toEqual([
      "collapsedHeader",
      "collapsedHeader",
    ]);
  });
});
