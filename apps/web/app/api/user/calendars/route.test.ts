import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createScopedLogger } from "@/utils/logger";

vi.mock("@/utils/prisma");
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_CONTACTS_ENABLED: false,
    NEXT_PUBLIC_EMAIL_SEND_ENABLED: false,
  },
}));
vi.mock("@/utils/middleware", () => ({
  withEmailAccount:
    (
      _name: string,
      handler: (
        request: NextRequest & {
          auth: { emailAccountId: string; userId: string };
          logger: ReturnType<typeof createScopedLogger>;
        },
        context: { params: Promise<Record<string, string>> },
      ) => Promise<Response>,
    ) =>
    (
      request: NextRequest,
      context: { params: Promise<Record<string, string>> },
    ) =>
      handler(
        Object.assign(request, {
          auth: { emailAccountId: "account-1", userId: "user-1" },
          logger: createScopedLogger("test"),
        }),
        context,
      ),
}));

import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/user/calendars", () => {
  it("exposes missing-scope reconnect state and calendar sync details", async () => {
    prisma.emailAccount.findUnique.mockResolvedValue({
      timezone: "Europe/Rome",
      calendarBookingLink: null,
      calendarConnections: [
        {
          id: "connection-1",
          email: "me@example.com",
          provider: "google",
          isConnected: true,
          // Existing consent, before settings and calendar-management scopes.
          scope:
            "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy",
          calendars: [
            {
              id: "calendar-1",
              name: "Work",
              isEnabled: true,
              primary: true,
              description: null,
              timezone: "Europe/Rome",
              color: "#4285f4",
              canEdit: true,
              syncStatus: "PAUSED",
              lastSyncedAt: new Date("2026-10-01T10:00:00Z"),
              syncRetryAt: new Date("2026-10-01T10:05:00Z"),
              syncError: null,
            },
          ],
        },
      ],
    } as never);

    const response = await GET(
      new NextRequest("http://localhost/api/user/calendars"),
      { params: Promise.resolve({}) },
    );
    const body = await response.json();

    expect(body.connections[0]).toMatchObject({
      id: "connection-1",
      state: "missing_scopes",
      calendars: [
        expect.objectContaining({
          color: "#4285f4",
          syncStatus: "PAUSED",
        }),
      ],
    });
    expect(body.connections[0]).not.toHaveProperty("scope");
  });

  it("keeps a disconnected connection distinct from missing scopes", async () => {
    prisma.emailAccount.findUnique.mockResolvedValue({
      timezone: null,
      calendarBookingLink: null,
      calendarConnections: [
        {
          id: "connection-1",
          email: "me@example.com",
          provider: "google",
          isConnected: false,
          scope: null,
          calendars: [],
        },
      ],
    } as never);

    const response = await GET(
      new NextRequest("http://localhost/api/user/calendars"),
      { params: Promise.resolve({}) },
    );

    expect((await response.json()).connections[0].state).toBe("disconnected");
  });
});
