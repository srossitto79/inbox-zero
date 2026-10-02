import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/prisma";
import { createTestLogger } from "@/__tests__/helpers";
import { pollGmailAccounts } from "./poll-gmail";
import { processHistoryForUser } from "@/utils/webhook/google/process-history";
import { createEmailProvider } from "@/utils/email/provider";

vi.mock("@/utils/prisma");
vi.mock("@/utils/premium", () => ({ getPremiumUserFilter: () => ({}) }));
vi.mock("@/utils/email/provider", () => ({ createEmailProvider: vi.fn() }));
vi.mock("@/utils/webhook/google/process-history", () => ({
  processHistoryForUser: vi.fn(),
}));

const logger = createTestLogger();

const emailAccount = (id: string, email: string) => ({
  id,
  email,
});

function mockGmailWithHistoryId(historyId: string | null | undefined) {
  vi.mocked(createEmailProvider).mockResolvedValue({
    getMailboxHistoryId: vi.fn().mockResolvedValue(historyId ?? null),
  } as never);
}

describe("pollGmailAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(processHistoryForUser).mockResolvedValue(undefined as never);
  });

  it("only selects Google accounts without an active watch", async () => {
    vi.mocked(prisma.emailAccount.findMany).mockResolvedValue([]);

    await pollGmailAccounts(logger);

    const { where } = vi.mocked(prisma.emailAccount.findMany).mock.calls[0][0]!;
    expect(where).toMatchObject({
      account: { provider: "google", disconnectedAt: null },
      OR: [
        { watchEmailsExpirationDate: null },
        { watchEmailsExpirationDate: { lt: expect.any(Date) } },
      ],
    });
  });

  it("processes history from the current mailbox history ID", async () => {
    vi.mocked(prisma.emailAccount.findMany).mockResolvedValue([
      emailAccount("account-1", "me@example.com"),
    ] as never);
    mockGmailWithHistoryId("12345");

    const result = await pollGmailAccounts(logger);

    expect(processHistoryForUser).toHaveBeenCalledWith(
      { emailAddress: "me@example.com", historyId: "12345" },
      {},
      expect.anything(),
    );
    expect(result).toEqual({ accounts: 1, polled: 1, failed: 0 });
  });

  it("keeps polling other accounts when one fails", async () => {
    vi.mocked(prisma.emailAccount.findMany).mockResolvedValue([
      emailAccount("account-1", "first@example.com"),
      emailAccount("account-2", "second@example.com"),
    ] as never);
    vi.mocked(createEmailProvider)
      .mockRejectedValueOnce(new Error("invalid_grant"))
      .mockResolvedValueOnce({
        getMailboxHistoryId: vi.fn().mockResolvedValue("99"),
      } as never);

    const result = await pollGmailAccounts(logger);

    expect(processHistoryForUser).toHaveBeenCalledTimes(1);
    expect(processHistoryForUser).toHaveBeenCalledWith(
      { emailAddress: "second@example.com", historyId: "99" },
      {},
      expect.anything(),
    );
    expect(result).toEqual({ accounts: 2, polled: 1, failed: 1 });
  });

  it("counts an account as failed when Gmail returns no history ID", async () => {
    vi.mocked(prisma.emailAccount.findMany).mockResolvedValue([
      emailAccount("account-1", "me@example.com"),
    ] as never);
    mockGmailWithHistoryId(undefined);

    const result = await pollGmailAccounts(logger);

    expect(processHistoryForUser).not.toHaveBeenCalled();
    expect(result).toEqual({ accounts: 1, polled: 0, failed: 1 });
  });
});
