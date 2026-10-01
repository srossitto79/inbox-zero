import { describe, expect, it } from "vitest";
import { buildPrintDocument } from "@/utils/email/print-messages";
import type { ParsedMessage } from "@/utils/types";

function message(overrides: Partial<ParsedMessage>): ParsedMessage {
  return {
    id: "m1",
    threadId: "t1",
    historyId: "1",
    snippet: "",
    subject: "Hello",
    date: "2026-09-30T10:00:00Z",
    inline: [],
    headers: {
      from: "Ann <ann@example.com>",
      to: "me@example.com",
      subject: "Hello",
      date: "2026-09-30T10:00:00Z",
    },
    ...overrides,
  };
}

describe("buildPrintDocument", () => {
  it("renders every message in order with its headers", () => {
    const html = buildPrintDocument(
      [
        message({ id: "a", textPlain: "first body" }),
        message({ id: "b", textPlain: "second body" }),
      ],
      "Hello",
    );
    expect(html.indexOf("first body")).toBeLessThan(
      html.indexOf("second body"),
    );
    expect(html.match(/<section>/g)).toHaveLength(2);
    expect(html).toContain("ann@example.com");
  });

  it("escapes plain text and the subject", () => {
    const html = buildPrintDocument(
      [message({ textPlain: "<script>alert(1)</script>" })],
      "<b>x</b>",
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
