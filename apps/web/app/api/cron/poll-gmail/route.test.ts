import { beforeEach, describe, expect, it, vi } from "vitest";

const { envMock, pollGmailAccountsMock, hasCronSecretMock } = vi.hoisted(
  () => ({
    envMock: { GMAIL_POLLING_ENABLED: true },
    pollGmailAccountsMock: vi.fn(),
    hasCronSecretMock: vi.fn(),
  }),
);

vi.mock("@/utils/middleware", async () => {
  const { createWithErrorTestMiddleware } = await vi.importActual<
    typeof import("@/__tests__/helpers")
  >("@/__tests__/helpers");

  return createWithErrorTestMiddleware();
});
vi.mock("@/env", () => ({ env: envMock }));
vi.mock("@/utils/cron", () => ({ hasCronSecret: hasCronSecretMock }));
vi.mock("@/utils/error", () => ({ captureException: vi.fn() }));
vi.mock("@/utils/webhook/google/poll-gmail", () => ({
  pollGmailAccounts: pollGmailAccountsMock,
}));

import { GET } from "./route";

const request = () =>
  new Request("http://localhost/api/cron/poll-gmail") as never;

describe("GET /api/cron/poll-gmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.GMAIL_POLLING_ENABLED = true;
    hasCronSecretMock.mockReturnValue(true);
    pollGmailAccountsMock.mockResolvedValue({
      accounts: 1,
      polled: 1,
      failed: 0,
    });
  });

  it("rejects requests without the cron secret", async () => {
    hasCronSecretMock.mockReturnValue(false);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(pollGmailAccountsMock).not.toHaveBeenCalled();
  });

  it("does nothing when polling is disabled", async () => {
    envMock.GMAIL_POLLING_ENABLED = false;

    const response = await GET(request());

    expect(await response.json()).toEqual({ enabled: false });
    expect(pollGmailAccountsMock).not.toHaveBeenCalled();
  });

  it("polls and returns the summary when enabled", async () => {
    const response = await GET(request());

    expect(await response.json()).toEqual({
      enabled: true,
      accounts: 1,
      polled: 1,
      failed: 0,
    });
  });
});
