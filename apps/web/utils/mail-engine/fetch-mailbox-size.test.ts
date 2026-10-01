import { afterEach, describe, expect, it, vi } from "vitest";
import { EMAIL_ACCOUNT_HEADER } from "@/utils/config";
import { fetchMailboxSize } from "@/utils/mail-engine/fetch-mailbox-size";

describe("fetchMailboxSize", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the email account header the route requires", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ threads: 1234 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMailboxSize("acc-1")).resolves.toEqual({ threads: 1234 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/user/mailbox-size");
    expect(new Headers(init.headers).get(EMAIL_ACCOUNT_HEADER)).toBe("acc-1");
  });

  it("throws on a rejected request instead of returning the error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "denied" }), { status: 403 }),
        ),
    );

    await expect(fetchMailboxSize("acc-1")).rejects.toThrow("403");
  });
});
