import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailLabel, EmailProvider } from "@/utils/email/types";
import { createScopedLogger } from "@/utils/logger";
import {
  clearStoredLabelReads,
  withStoredLabelReads,
} from "@/utils/mail-engine/server/stored-label-reads";

vi.mock("server-only", () => ({}));

const logger = createScopedLogger("stored-label-reads-test");

const processed: EmailLabel = {
  id: "L1",
  name: "Inbox Zero/Processed",
  type: "user",
};
const hidden: EmailLabel = {
  id: "L2",
  name: "Hidden",
  type: "user",
  labelListVisibility: "labelHide",
};

function setup(labels: EmailLabel[] = [processed, hidden]) {
  const getLabels = vi.fn(async () => labels);
  const getLabelByName = vi.fn(async () => null);
  const createLabel = vi.fn(async (name: string) => ({
    id: "NEW",
    name,
    type: "user",
  }));
  const deleteLabel = vi.fn(async () => {});
  const getOrCreateInboxZeroLabel = vi.fn(async () => processed);
  const provider = withStoredLabelReads(
    {
      getLabels,
      getLabelByName,
      createLabel,
      deleteLabel,
      getOrCreateInboxZeroLabel,
    } as unknown as EmailProvider,
    "acc-1",
    logger,
  );
  return {
    provider,
    getLabels,
    getLabelByName,
    createLabel,
    deleteLabel,
    getOrCreateInboxZeroLabel,
  };
}

describe("withStoredLabelReads", () => {
  beforeEach(() => clearStoredLabelReads());

  it("lists labels once and hides hidden ones unless asked", async () => {
    const { provider, getLabels } = setup();

    expect(await provider.getLabels()).toEqual([processed]);
    expect(await provider.getLabels({ includeHidden: true })).toEqual([
      processed,
      hidden,
    ]);
    expect(getLabels).toHaveBeenCalledTimes(1);
  });

  it("finds an existing label by name without asking the provider", async () => {
    const { provider, getLabelByName } = setup();

    expect(await provider.getLabelByName("Inbox Zero/Processed")).toBe(
      processed,
    );
    expect(getLabelByName).not.toHaveBeenCalled();
  });

  it("falls back to the provider when the name is not cached", async () => {
    const { provider, getLabelByName } = setup();

    expect(await provider.getLabelByName("Other")).toBeNull();
    expect(getLabelByName).toHaveBeenCalledWith("Other");
  });

  it("returns an existing Inbox Zero label without creating it", async () => {
    const { provider, getOrCreateInboxZeroLabel } = setup();

    expect(await provider.getOrCreateInboxZeroLabel("processed")).toBe(
      processed,
    );
    expect(getOrCreateInboxZeroLabel).not.toHaveBeenCalled();
  });

  it("creates a missing Inbox Zero label through the provider", async () => {
    const { provider, getOrCreateInboxZeroLabel, getLabels } = setup([]);

    await provider.getOrCreateInboxZeroLabel("processed");
    await provider.getLabels();

    expect(getOrCreateInboxZeroLabel).toHaveBeenCalledTimes(1);
    expect(getLabels).toHaveBeenCalledTimes(2);
  });

  it("reloads labels after a create and after a delete", async () => {
    const { provider, getLabels } = setup();

    await provider.getLabels();
    await provider.createLabel("X");
    await provider.getLabels();
    await provider.deleteLabel("L1");
    await provider.getLabels();

    expect(getLabels).toHaveBeenCalledTimes(3);
  });

  it("does not cache a failed load", async () => {
    const { provider, getLabels } = setup();
    getLabels.mockRejectedValueOnce(new Error("quota"));

    await expect(provider.getLabels()).rejects.toThrow("quota");
    expect(await provider.getLabels()).toEqual([processed]);
  });

  it("reloads after the TTL", async () => {
    vi.useFakeTimers();
    try {
      const { provider, getLabels } = setup();
      await provider.getLabels();
      vi.advanceTimersByTime(61_000);
      await provider.getLabels();
      expect(getLabels).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
