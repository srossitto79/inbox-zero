import { describe, expect, it, vi } from "vitest";
import {
  getCalendarConnectionState,
  getMissingCalendarScopes,
} from "./connection-scopes";

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_CONTACTS_ENABLED: false,
    NEXT_PUBLIC_EMAIL_SEND_ENABLED: false,
  },
}));

const GOOGLE_BASE =
  "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy";

describe("getMissingCalendarScopes", () => {
  it("treats a connection without a stored scope as missing everything", () => {
    const missing = getMissingCalendarScopes({
      provider: "google",
      grantedScope: null,
    });

    expect(missing).toContain(
      "https://www.googleapis.com/auth/calendar.calendars",
    );
    expect(missing).toContain(
      "https://www.googleapis.com/auth/calendar.readonly",
    );
  });

  it("reports only the Google scopes added after the original consent", () => {
    expect(
      getMissingCalendarScopes({
        provider: "google",
        grantedScope: GOOGLE_BASE,
      }),
    ).toEqual([
      "https://www.googleapis.com/auth/calendar.settings.readonly",
      "https://www.googleapis.com/auth/calendar.calendars",
    ]);
  });

  it("reports nothing once every scope is granted", () => {
    const granted = `${GOOGLE_BASE} https://www.googleapis.com/auth/calendar.settings.readonly https://www.googleapis.com/auth/calendar.calendars`;

    expect(
      getMissingCalendarScopes({ provider: "google", grantedScope: granted }),
    ).toEqual([]);
  });

  it("matches Microsoft scopes case-insensitively and with the Graph prefix", () => {
    const granted =
      "openid profile https://graph.microsoft.com/Calendars.Read calendars.readwrite Calendars.ReadWrite.Shared MailboxSettings.Read";

    expect(
      getMissingCalendarScopes({
        provider: "microsoft",
        grantedScope: granted,
      }),
    ).toEqual([]);
  });

  it("does not require identity scopes the provider omits", () => {
    expect(
      getMissingCalendarScopes({
        provider: "microsoft",
        grantedScope:
          "Calendars.Read Calendars.ReadWrite Calendars.ReadWrite.Shared MailboxSettings.Read",
      }),
    ).toEqual([]);
  });
});

describe("getCalendarConnectionState", () => {
  it("prefers the disconnected state over missing scopes", () => {
    expect(
      getCalendarConnectionState({
        provider: "google",
        isConnected: false,
        scope: null,
      }),
    ).toBe("disconnected");
  });

  it("flags a live connection that lacks scopes", () => {
    expect(
      getCalendarConnectionState({
        provider: "google",
        isConnected: true,
        scope: GOOGLE_BASE,
      }),
    ).toBe("missing_scopes");
  });
});
