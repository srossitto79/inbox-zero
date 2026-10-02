import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth, type gmail_v1 } from "@googleapis/gmail";
import { redis } from "@/utils/redis";
import { createTestLogger } from "@/__tests__/helpers";
import { isProviderRateLimitModeError } from "@/utils/email/rate-limit-mode-error";
import * as redisState from "@/utils/redis/email-provider-rate-limit";
import {
  chargeGmailQuota,
  classifyGmailRequestCost,
  getBatchUnits,
  installGmailQuotaMeter,
  runWithGmailQuotaPriority,
} from "./quota-meter";

vi.mock("@/utils/redis", () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), eval: vi.fn() },
}));

const logger = createTestLogger();
const root = "https://gmail.googleapis.com/gmail/v1/users/me";
const upload = "https://gmail.googleapis.com/upload/gmail/v1/users/me";

describe("classifyGmailRequestCost", () => {
  it.each([
    ["GET", `${root}/messages/abc?format=full`, 5],
    ["GET", `${root}/messages?q=in:inbox`, 5],
    ["GET", `${root}/messages/abc/attachments/att`, 5],
    ["POST", `${root}/messages/abc/modify`, 5],
    ["POST", `${root}/messages/abc/trash`, 5],
    ["DELETE", `${root}/messages/abc`, 10],
    ["POST", `${root}/messages/batchModify`, 50],
    ["POST", `${root}/messages/send`, 100],
    ["POST", `${upload}/messages/send?uploadType=multipart`, 100],
    ["POST", `${root}/messages/import`, 25],
    ["GET", `${root}/threads/abc`, 10],
    ["GET", `${root}/threads?q=x`, 10],
    ["POST", `${root}/threads/abc/modify`, 10],
    ["DELETE", `${root}/threads/abc`, 20],
    ["GET", `${root}/labels`, 1],
    ["GET", `${root}/labels/Label_1`, 1],
    ["POST", `${root}/labels`, 5],
    ["PATCH", `${root}/labels/Label_1`, 5],
    ["GET", `${root}/history?startHistoryId=1`, 2],
    ["GET", `${root}/profile`, 1],
    ["POST", `${root}/drafts`, 10],
    ["PUT", `${root}/drafts/d1`, 15],
    ["POST", `${root}/drafts/send`, 100],
    ["POST", `${root}/watch`, 100],
    ["POST", `${root}/stop`, 50],
    ["GET", `${root}/settings/filters`, 1],
    ["POST", `${root}/settings/filters`, 1],
    ["PATCH", `${root}/settings/sendAs/a@b.c`, 100],
    ["GET", `${root}/somethingNew`, 5],
  ])("%s %s costs %i units", (method, url, units) => {
    expect(classifyGmailRequestCost({ method, url })?.units).toBe(units);
  });

  it("ignores requests that are not Gmail API calls", () => {
    expect(
      classifyGmailRequestCost({
        method: "POST",
        url: "https://oauth2.googleapis.com/token",
      }),
    ).toBeNull();
  });

  it("prices a batch by its sub-requests", () => {
    expect(
      getBatchUnits({ endpoint: "/gmail/v1/users/me/messages", count: 50 }),
    ).toBe(250);
    expect(
      getBatchUnits({ endpoint: "/gmail/v1/users/me/threads", count: 10 }),
    ).toBe(100);
  });
});

describe("chargeGmailQuota", () => {
  beforeEach(() => {
    vi.mocked(redis.eval).mockReset();
    vi.mocked(redis.get).mockReset().mockResolvedValue(null);
    vi.mocked(redis.set).mockReset();
  });

  it("admits a request that fits the budget", async () => {
    vi.mocked(redis.eval).mockResolvedValue(0);
    await chargeGmailQuota({ emailAccountId: "a", units: 5, logger });
    const [, keys, args] = vi.mocked(redis.eval).mock.calls[0]!;
    expect(keys).toEqual(["gmail-quota:a"]);
    expect(args).toEqual(["5", "12000", "-1200"]);
  });

  it("lets background work drain the budget only down to the interactive reserve", async () => {
    vi.mocked(redis.eval).mockResolvedValue(0);
    await runWithGmailQuotaPriority("backfill", () =>
      chargeGmailQuota({ emailAccountId: "a", units: 5, logger }),
    );
    expect(vi.mocked(redis.eval).mock.calls[0]![2]).toEqual([
      "5",
      "12000",
      "3600",
    ]);
  });

  it("throws a rate-limit pause with retryAt when the budget is spent", async () => {
    vi.mocked(redis.eval).mockResolvedValue(20_000);
    const before = Date.now();
    const error = await chargeGmailQuota({
      emailAccountId: "a",
      units: 100,
      logger,
    }).catch((e) => e);
    expect(isProviderRateLimitModeError(error)).toBe(true);
    expect(new Date(error.retryAt).getTime()).toBeGreaterThanOrEqual(
      before + 20_000,
    );
  });

  it("blocks without charging while rate-limit mode is active", async () => {
    vi.mocked(redis.get).mockResolvedValue(
      JSON.stringify({
        provider: "google",
        retryAt: new Date(Date.now() + 30_000).toISOString(),
      }),
    );
    const error = await chargeGmailQuota({
      emailAccountId: "a",
      units: 100,
      logger,
    }).catch((e) => e);
    expect(isProviderRateLimitModeError(error)).toBe(true);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("fails open when Redis is not configured", async () => {
    const spy = vi
      .spyOn(redisState, "isEmailProviderRateLimitRedisConfigured")
      .mockReturnValue(false);
    await expect(
      chargeGmailQuota({ emailAccountId: "a", units: 100, logger }),
    ).resolves.toBeUndefined();
    expect(redis.eval).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("fails open when Redis errors", async () => {
    vi.mocked(redis.eval).mockRejectedValue(new Error("redis down"));
    await expect(
      chargeGmailQuota({ emailAccountId: "a", units: 5, logger }),
    ).resolves.toBeUndefined();
  });
});

describe("installGmailQuotaMeter", () => {
  beforeEach(() => {
    vi.mocked(redis.eval).mockReset().mockResolvedValue(0);
    vi.mocked(redis.get).mockReset().mockResolvedValue(null);
    vi.mocked(redis.set).mockReset();
  });

  function setup(response: Response) {
    const authClient = new auth.OAuth2();
    installGmailQuotaMeter({
      authClient,
      client: {} as gmail_v1.Gmail,
      emailAccountId: "a",
      logger,
    });
    const fetchImplementation = vi.fn().mockResolvedValue(response);
    const send = (url: string, method = "GET") =>
      authClient.transporter.request({ url, method, fetchImplementation });
    return { send, fetchImplementation };
  }

  it("charges each Gmail request before sending it", async () => {
    const { send, fetchImplementation } = setup(
      new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    await send(`${root}/threads/t1`);
    expect(vi.mocked(redis.eval).mock.calls[0]![2]![0]).toBe("10");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("does not charge or block non-Gmail requests", async () => {
    const { send, fetchImplementation } = setup(
      new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    await send("https://oauth2.googleapis.com/token", "POST");
    expect(redis.eval).not.toHaveBeenCalled();
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("does not send when the budget is spent", async () => {
    vi.mocked(redis.eval).mockResolvedValue(5000);
    const { send, fetchImplementation } = setup(new Response("{}"));
    const error = await send(`${root}/messages/send`, "POST").catch((e) => e);
    expect(isProviderRateLimitModeError(error)).toBe(true);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("records at least a minute of rate-limit mode on a quota 403", async () => {
    const { send } = setup(
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            message: "User-rate limit exceeded.",
            errors: [{ reason: "rateLimitExceeded" }],
          },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );
    const before = Date.now();
    await expect(send(`${root}/messages/m1`)).rejects.toBeDefined();
    const [key, value, options] = vi.mocked(redis.set).mock.calls[0]!;
    expect(key).toBe("email-provider-rate-limit:a");
    expect(
      new Date(JSON.parse(value as string).retryAt).getTime() - before,
    ).toBeGreaterThanOrEqual(59_000);
    expect((options as { ex: number }).ex).toBeGreaterThanOrEqual(60);
  });

  it("does not record rate-limit mode for other errors", async () => {
    const { send } = setup(
      new Response(
        JSON.stringify({ error: { code: 404, message: "Not Found" } }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(send(`${root}/messages/m1`)).rejects.toBeDefined();
    expect(redis.set).not.toHaveBeenCalled();
  });
});
