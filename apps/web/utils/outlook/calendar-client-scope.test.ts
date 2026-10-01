import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestLogger } from "@/__tests__/helpers";
import { CALENDAR_BASE_SCOPES } from "@/utils/outlook/scopes";
import prisma from "@/utils/__mocks__/prisma";
import { requestMicrosoftToken } from "@/utils/microsoft/oauth";
import { getCalendarClientWithRefresh } from "./calendar-client";

vi.mock("@microsoft/microsoft-graph-client", () => ({
  Client: {
    initWithMiddleware: vi.fn(),
  },
}));

vi.mock("@/utils/prisma");

vi.mock("@/utils/microsoft/oauth", () => ({
  getMicrosoftGraphClientOptions: vi.fn(() => ({
    baseUrl: "http://localhost:4003/",
  })),
  getMicrosoftOauthAuthorizeUrl: vi.fn(
    () => "http://localhost:4003/oauth2/v2.0/authorize",
  ),
  requestMicrosoftToken: vi.fn(),
}));

vi.mock("@/env", () => ({
  env: {
    MICROSOFT_CLIENT_ID: "client-id",
    MICROSOFT_CLIENT_SECRET: "client-secret",
    NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
  },
}));

const logger = createTestLogger();

describe("getCalendarClientWithRefresh scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.calendarConnection.updateMany.mockResolvedValue({ count: 1 });
    vi.mocked(requestMicrosoftToken).mockResolvedValue(
      Response.json({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
      }),
    );
  });

  const call = (connectionId?: string) =>
    getCalendarClientWithRefresh({
      refreshToken: "refresh-token",
      expiresAt: null,
      emailAccountId: "email-account-id",
      connectionId,
      logger,
    });

  it("refreshes with the scope stored on the connection", async () => {
    prisma.calendarConnection.findFirst.mockResolvedValue({
      scope: "offline_access Calendars.ReadWrite.Shared",
    } as never);

    await call("connection-id");

    expect(requestMicrosoftToken).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "offline_access Calendars.ReadWrite.Shared",
      }),
    );
  });

  it("keeps the base scopes when no scope is stored", async () => {
    prisma.calendarConnection.findFirst.mockResolvedValue({
      scope: null,
    } as never);

    await call();

    expect(requestMicrosoftToken).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: CALENDAR_BASE_SCOPES.join(" "),
      }),
    );
  });
});
