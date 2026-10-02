import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { gmail_v1 } from "@googleapis/gmail";
import { redis } from "@/utils/redis";
import { createTestLogger } from "@/__tests__/helpers";
import { isProviderRateLimitModeError } from "@/utils/email/rate-limit-mode-error";
import { getBatch } from "./batch";
import {
  installGmailQuotaMeter,
  rememberGmailAccessToken,
} from "./quota-meter";

vi.mock("@/utils/google/oauth", () => ({
  getGoogleGmailBatchUrl: () => "https://example.com/batch/gmail/v1",
}));
vi.mock("@/utils/redis", () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), eval: vi.fn() },
}));

const logger = createTestLogger();
const endpoint = "/gmail/v1/users/me/messages";

function batchResponse(part: string) {
  return new Response(
    `--b\r\nContent-Type: application/http\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n${part}\r\n--b--`,
    { headers: { "Content-Type": "multipart/mixed; boundary=b" } },
  );
}

describe("getBatch metering", () => {
  beforeEach(() => {
    vi.mocked(redis.eval).mockReset().mockResolvedValue(0);
    vi.mocked(redis.get).mockReset().mockResolvedValue(null);
    vi.mocked(redis.set).mockReset();
    const client = {} as gmail_v1.Gmail;
    installGmailQuotaMeter({
      authClient: {},
      client,
      emailAccountId: "a",
      logger,
    });
    rememberGmailAccessToken(client, "token-a");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("charges the sub-requests of a batch to the owning account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(batchResponse("{}")));
    await getBatch(["1", "2", "3"], endpoint, "token-a");
    expect(vi.mocked(redis.eval).mock.calls[0]![2]![0]).toBe("15");
  });

  it("does not send a batch the budget cannot cover", async () => {
    vi.mocked(redis.eval).mockResolvedValue(10_000);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const error = await getBatch(["1"], endpoint, "token-a").catch((e) => e);
    expect(isProviderRateLimitModeError(error)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records rate-limit mode when a sub-request is quota limited", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        batchResponse(
          JSON.stringify({
            error: {
              code: 429,
              message: "Too many requests",
              errors: [{ reason: "rateLimitExceeded" }],
            },
          }),
        ),
      ),
    );
    const before = Date.now();
    await getBatch(["1"], endpoint, "token-a");
    const [key, value] = vi.mocked(redis.set).mock.calls[0]!;
    expect(key).toBe("email-provider-rate-limit:a");
    expect(
      new Date(JSON.parse(value as string).retryAt).getTime() - before,
    ).toBeGreaterThanOrEqual(59_000);
  });

  it("leaves tokens of unknown accounts unmetered", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(batchResponse("{}")));
    await getBatch(["1"], endpoint, "other-token");
    expect(redis.eval).not.toHaveBeenCalled();
  });
});
