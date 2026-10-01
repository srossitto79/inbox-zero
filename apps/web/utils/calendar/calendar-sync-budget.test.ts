import { beforeEach, describe, expect, it, vi } from "vitest";
import { redis } from "@/utils/redis";
import { isEmailProviderRateLimitRedisConfigured } from "@/utils/redis/email-provider-rate-limit";
import {
  CalendarSyncPausedError,
  withCalendarSyncBudget,
} from "./calendar-sync-budget";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/redis", () => ({ redis: { eval: vi.fn(), set: vi.fn() } }));
vi.mock("@/utils/redis/email-provider-rate-limit");

const input = { emailAccountId: "account-1", provider: "google" } as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isEmailProviderRateLimitRedisConfigured).mockReturnValue(true);
  vi.mocked(redis.eval).mockResolvedValue(0);
  vi.mocked(redis.set).mockResolvedValue("OK");
});

describe("withCalendarSyncBudget", () => {
  it("runs the operation once the bucket admits it", async () => {
    const operation = vi.fn().mockResolvedValue("page");

    await expect(withCalendarSyncBudget(input, operation)).resolves.toBe(
      "page",
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does not call the provider when Redis is unconfigured or failing", async () => {
    const operation = vi.fn();
    vi.mocked(redis.eval).mockRejectedValueOnce(new Error("unavailable"));

    await expect(
      withCalendarSyncBudget(input, operation),
    ).rejects.toBeInstanceOf(CalendarSyncPausedError);

    vi.mocked(isEmailProviderRateLimitRedisConfigured).mockReturnValue(false);
    await expect(
      withCalendarSyncBudget(input, operation),
    ).rejects.toBeInstanceOf(CalendarSyncPausedError);
    expect(operation).not.toHaveBeenCalled();
  });

  it("pauses for the wait the bucket reports instead of calling the provider", async () => {
    vi.mocked(redis.eval).mockResolvedValue(45_000);
    const operation = vi.fn();

    await expect(
      withCalendarSyncBudget(input, operation),
    ).rejects.toMatchObject({ retryAfterMs: 45_000 });
    expect(operation).not.toHaveBeenCalled();
  });

  it("starts a cooldown and pauses when the provider rate-limits", async () => {
    const operation = vi.fn().mockRejectedValue(
      Object.assign(new Error("Rate Limit Exceeded"), {
        code: 429,
        response: { status: 429, headers: { "retry-after": "90" } },
      }),
    );

    await expect(
      withCalendarSyncBudget(input, operation),
    ).rejects.toBeInstanceOf(CalendarSyncPausedError);
    expect(redis.set).toHaveBeenCalledWith(
      "calendar-sync-budget:google:account-1:cooldown",
      expect.any(String),
      expect.objectContaining({ px: expect.any(Number) }),
    );
  });

  it("rethrows other provider errors untouched", async () => {
    const failure = Object.assign(new Error("Not Found"), {
      code: 404,
      response: { status: 404 },
    });

    await expect(
      withCalendarSyncBudget(input, vi.fn().mockRejectedValue(failure)),
    ).rejects.toBe(failure);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("rejects a malformed reservation", async () => {
    await expect(
      withCalendarSyncBudget({ ...input, cost: 0 }, vi.fn()),
    ).rejects.toThrow("Invalid calendar sync reservation");
  });
});
