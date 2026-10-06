import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/messaging/app-credentials", () => ({
  loadAdapterConfigs: vi.fn(),
}));
vi.mock("@/utils/messaging/chat-sdk/adapters", () => ({
  createMessagingAdapterRegistry: vi.fn(),
  resetMessagingAdapterRegistry: vi.fn(),
  NoMessagingAdaptersError: class NoMessagingAdaptersError extends Error {},
}));
vi.mock("@/utils/messaging/chat-sdk/bot", () => ({
  resetMessagingChatSdkBot: vi.fn(),
}));

import { loadAdapterConfigs } from "@/utils/messaging/app-credentials";
import {
  createMessagingAdapterRegistry,
  NoMessagingAdaptersError,
  resetMessagingAdapterRegistry,
} from "@/utils/messaging/chat-sdk/adapters";
import { resetMessagingChatSdkBot } from "@/utils/messaging/chat-sdk/bot";
import {
  ensureMessagingAdaptersHydrated,
  invalidateMessagingAdapterHydration,
} from "./adapter-hydration";

const registryWith = (platforms: string[]) =>
  ({
    adapters: Object.fromEntries(platforms.map((platform) => [platform, {}])),
    typedAdapters: {},
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  global.inboxZeroMessagingAdaptersHydrated = undefined;
  global.inboxZeroMessagingAdapterHydration = undefined;
  global.inboxZeroMessagingAdapterRegistry = undefined;
  vi.mocked(loadAdapterConfigs).mockResolvedValue({});
  vi.mocked(resetMessagingAdapterRegistry).mockImplementation(() => {
    global.inboxZeroMessagingAdapterRegistry = undefined;
  });
  vi.mocked(createMessagingAdapterRegistry).mockReturnValue(
    registryWith(["slack"]),
  );
});

describe("ensureMessagingAdaptersHydrated", () => {
  it("installs the hydrated registry when none exists yet", async () => {
    const next = registryWith(["slack"]);
    vi.mocked(createMessagingAdapterRegistry).mockReturnValue(next);

    await ensureMessagingAdaptersHydrated();

    expect(loadAdapterConfigs).toHaveBeenCalledOnce();
    expect(createMessagingAdapterRegistry).toHaveBeenCalledWith({});
    expect(global.inboxZeroMessagingAdapterRegistry).toBe(next);
    expect(resetMessagingChatSdkBot).not.toHaveBeenCalled();
    expect(global.inboxZeroMessagingAdaptersHydrated).toBe(true);
  });

  it("does not reload once hydrated", async () => {
    await ensureMessagingAdaptersHydrated();
    await ensureMessagingAdaptersHydrated();

    expect(loadAdapterConfigs).toHaveBeenCalledOnce();
    expect(createMessagingAdapterRegistry).toHaveBeenCalledOnce();
  });

  it("replaces the registry and resets the bot when stored configs add platforms", async () => {
    global.inboxZeroMessagingAdapterRegistry = registryWith(["slack"]);
    const next = registryWith(["slack", "teams"]);
    vi.mocked(createMessagingAdapterRegistry).mockReturnValue(next);

    await ensureMessagingAdaptersHydrated();

    expect(global.inboxZeroMessagingAdapterRegistry).toBe(next);
    expect(resetMessagingChatSdkBot).toHaveBeenCalledOnce();
  });

  it("keeps the current registry when stored configs add nothing", async () => {
    const current = registryWith(["slack", "teams"]);
    global.inboxZeroMessagingAdapterRegistry = current;
    vi.mocked(createMessagingAdapterRegistry).mockReturnValue(
      registryWith(["slack", "teams"]),
    );

    await ensureMessagingAdaptersHydrated();

    expect(global.inboxZeroMessagingAdapterRegistry).toBe(current);
    expect(resetMessagingChatSdkBot).not.toHaveBeenCalled();
  });

  it("retries on the next call when loading fails", async () => {
    vi.mocked(loadAdapterConfigs).mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await ensureMessagingAdaptersHydrated();

    expect(global.inboxZeroMessagingAdaptersHydrated).toBeUndefined();
    expect(global.inboxZeroMessagingAdapterRegistry).toBeUndefined();

    await ensureMessagingAdaptersHydrated();

    expect(loadAdapterConfigs).toHaveBeenCalledTimes(2);
    expect(global.inboxZeroMessagingAdaptersHydrated).toBe(true);
  });

  it("treats an unconfigured setup as hydrated instead of retrying", async () => {
    vi.mocked(createMessagingAdapterRegistry).mockImplementation(() => {
      throw new NoMessagingAdaptersError();
    });

    await ensureMessagingAdaptersHydrated();
    await ensureMessagingAdaptersHydrated();

    expect(global.inboxZeroMessagingAdaptersHydrated).toBe(true);
    expect(global.inboxZeroMessagingAdapterRegistry).toBeUndefined();
    expect(loadAdapterConfigs).toHaveBeenCalledOnce();
  });
});

describe("invalidateMessagingAdapterHydration", () => {
  it("clears hydrated state and rebuilds from the new config", async () => {
    await ensureMessagingAdaptersHydrated();
    const next = registryWith(["slack", "teams"]);
    vi.mocked(createMessagingAdapterRegistry).mockReturnValue(next);

    await invalidateMessagingAdapterHydration();

    expect(resetMessagingAdapterRegistry).toHaveBeenCalled();
    expect(resetMessagingChatSdkBot).toHaveBeenCalled();
    expect(createMessagingAdapterRegistry).toHaveBeenCalledTimes(2);
    expect(global.inboxZeroMessagingAdapterRegistry).toBe(next);
    expect(global.inboxZeroMessagingAdaptersHydrated).toBe(true);
  });
});
