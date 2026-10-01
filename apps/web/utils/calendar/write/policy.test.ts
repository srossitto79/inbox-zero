import { describe, expect, it } from "vitest";
import {
  composeGuests,
  getWriteBlock,
  getWriteBlockMessage,
  hasOtherGuests,
  resolveSendUpdates,
} from "@/utils/calendar/write/policy";

describe("getWriteBlock", () => {
  it("allows a connected, editable Google calendar", () => {
    expect(
      getWriteBlock({ provider: "google", state: "connected", canEdit: true }),
    ).toBeNull();
  });

  it("explains why writing is blocked", () => {
    expect(
      getWriteBlock({
        provider: "microsoft",
        state: "connected",
        canEdit: true,
      }),
    ).toBe("unsupported");
    expect(
      getWriteBlock({
        provider: "google",
        state: "missing_scopes",
        canEdit: true,
      }),
    ).toBe("reconnect");
    expect(
      getWriteBlock({
        provider: "google",
        state: "disconnected",
        canEdit: true,
      }),
    ).toBe("disconnected");
    expect(
      getWriteBlock({ provider: "google", state: "connected", canEdit: false }),
    ).toBe("read_only");
    expect(getWriteBlockMessage("reconnect")).toBe(
      "Reconnect Google Calendar to edit events",
    );
  });
});

describe("resolveSendUpdates", () => {
  it("invites when guests are involved and stays quiet otherwise", () => {
    expect(
      resolveSendUpdates({ requested: undefined, hasOtherGuests: true }),
    ).toBe("all");
    expect(
      resolveSendUpdates({ requested: undefined, hasOtherGuests: false }),
    ).toBe("none");
    expect(
      resolveSendUpdates({ requested: "none", hasOtherGuests: true }),
    ).toBe("none");
  });
});

describe("composeGuests", () => {
  const stored = [
    {
      email: "Host@example.com",
      isOrganizer: true,
      responseStatus: "accepted",
    },
    { email: "me@example.com", isSelf: true, responseStatus: "tentative" },
    { email: "a@example.com", responseStatus: "declined", name: "A" },
  ];

  it("keeps the organizer, the viewer and the answers of kept guests", () => {
    expect(
      composeGuests({
        stored,
        incoming: [{ email: "A@example.com" }, { email: "b@example.com" }],
      }),
    ).toEqual([
      {
        email: "Host@example.com",
        name: undefined,
        responseStatus: "accepted",
      },
      { email: "me@example.com", name: undefined, responseStatus: "tentative" },
      { email: "a@example.com", name: "A", responseStatus: "declined" },
      { email: "b@example.com", name: undefined },
    ]);
  });

  it("removes guests missing from the editor and ignores duplicates", () => {
    const result = composeGuests({
      stored,
      incoming: [{ email: "b@example.com" }, { email: "B@example.com" }],
    });

    expect(result.map((guest) => guest.email)).toEqual([
      "Host@example.com",
      "me@example.com",
      "b@example.com",
    ]);
  });

  it("does not let the editor re-add the viewer as a plain guest", () => {
    const result = composeGuests({
      stored,
      incoming: [{ email: "ME@example.com" }],
    });

    expect(result.filter((guest) => /^me@/i.test(guest.email))).toHaveLength(1);
  });
});

describe("hasOtherGuests", () => {
  it("ignores the viewer and the organizer", () => {
    expect(
      hasOtherGuests([
        { email: "me@example.com", isSelf: true },
        { email: "host@example.com", isOrganizer: true },
      ]),
    ).toBe(false);
    expect(hasOtherGuests([{ email: "a@example.com" }])).toBe(true);
  });
});
