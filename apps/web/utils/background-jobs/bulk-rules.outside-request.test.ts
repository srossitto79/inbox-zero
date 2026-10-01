import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { ActionType, ExecutedRuleStatus } from "@/generated/prisma/enums";
import {
  getAction,
  getEmailAccount,
  createTestLogger,
} from "@/__tests__/helpers";
import { findMatchingRules } from "@/utils/ai/choose-rule/match-rules";
import { getActionItemsWithAiArgs } from "@/utils/ai/choose-rule/choose-args";
import { createEmailProvider } from "@/utils/email/provider";
import { getEmailAccountForRuleExecution } from "@/utils/user/get";
import { loadThreads } from "@/utils/threads/load";
import { withLocalMailSyncBudget } from "@/utils/email/local-mail-sync-budget";
import { runBulkRulesChunk } from "@/utils/background-jobs/bulk-rules";

// The shared test setup makes `after()` run its task synchronously, which hid
// a bug: the worker has no request scope, where Next's real `after()` throws.
// `runRules` is real here, so any direct `after()` call on this path fails
// the email.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {
    throw new Error("`after` was called outside a request scope");
  },
}));
vi.mock("@/utils/prisma");
vi.mock("server-only", () => ({}));
vi.mock("@/utils/email/provider", () => ({ createEmailProvider: vi.fn() }));
vi.mock("@/utils/user/get", () => ({
  getEmailAccountForRuleExecution: vi.fn(),
}));
vi.mock("@/utils/threads/load", () => ({ loadThreads: vi.fn() }));
vi.mock("@/utils/ai/choose-rule/match-rules", () => ({
  findMatchingRules: vi.fn(),
}));
vi.mock("@/utils/ai/choose-rule/choose-args", () => ({
  getActionItemsWithAiArgs: vi.fn(),
}));
vi.mock("@/utils/ai/choose-rule/execute", () => ({ executeAct: vi.fn() }));
vi.mock("@/utils/reply-tracker/handle-conversation-status", () => ({
  determineConversationStatus: vi.fn(),
  updateThreadTrackers: vi.fn(),
}));
vi.mock("@/utils/reply-tracker/label-helpers", () => ({
  removeConflictingThreadStatusLabels: vi.fn(),
}));
vi.mock("@/utils/rule/learned-patterns", () => ({
  saveLearnedPattern: vi.fn(),
  saveLearnedPatterns: vi.fn(),
  hasIncludePatternOnAnotherRule: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/utils/scheduled-actions/scheduler", () => ({
  scheduleDelayedActions: vi.fn(),
  cancelScheduledActions: vi.fn(),
}));
vi.mock("@/utils/posthog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/posthog")>()),
  trackFirstTimeEvent: vi.fn(),
}));
vi.mock("@/utils/email/local-mail-sync-budget", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/utils/email/local-mail-sync-budget")
  >()),
  withLocalMailSyncBudget: vi.fn(),
}));

const logger = createTestLogger();

describe("bulk rules outside a request", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(withLocalMailSyncBudget).mockImplementation((_input, operation) =>
      operation(new AbortController().signal),
    );
    vi.mocked(getEmailAccountForRuleExecution).mockResolvedValue({
      ...getEmailAccount(),
      account: { provider: "google" },
    } as never);
    vi.mocked(createEmailProvider).mockResolvedValue({
      name: "google",
      getMessage: vi.fn(async (id: string) => ({
        id,
        threadId: "thread-1",
        snippet: "",
        historyId: "h1",
        inline: [],
        headers: {
          from: "sender@example.com",
          to: "me@example.com",
          subject: "Hello",
          date: new Date().toISOString(),
        },
        textPlain: "Hello",
      })),
    } as never);
    vi.mocked(loadThreads).mockResolvedValue({
      threads: [
        {
          id: "thread-1",
          messages: [
            {
              id: "message-1",
              headers: { from: "sender@example.com", subject: "Hello" },
            },
          ],
        },
      ],
    } as never);

    const rule = {
      id: "rule-1",
      name: "Newsletter",
      enabled: true,
      systemType: null,
      actions: [getAction({ id: "a1", type: ActionType.LABEL })],
    };
    prisma.rule.findMany.mockResolvedValue([rule] as never);
    vi.mocked(findMatchingRules).mockResolvedValue({
      matches: [{ rule, matchReasons: [] }],
      reasoning: "Matched",
    } as never);
    vi.mocked(getActionItemsWithAiArgs).mockResolvedValue([
      getAction({ id: "a1", type: ActionType.LABEL }),
    ] as never);
    prisma.executedRule.findFirst.mockResolvedValue(null);
    prisma.executedRule.create.mockResolvedValue({
      id: "exec-1",
      status: ExecutedRuleStatus.APPLYING,
      ruleId: "rule-1",
      threadId: "thread-1",
      messageId: "message-1",
      actionItems: [],
    } as never);
  });

  it("processes an email with the real rules pipeline and no request scope", async () => {
    const chunk = await runBulkRulesChunk({
      job: {
        id: "job-1",
        emailAccountId: "account-1",
        payload: {
          startDate: "2026-01-01T00:00:00.000Z",
          includeRead: false,
          rerun: false,
          generateDraftReplies: false,
          pageProcessedThreadIds: [],
        },
        result: null,
        progressDone: 0,
      } as never,
      logger,
      checkpoint: async () => false,
    });

    expect(chunk.result).toMatchObject({ processed: 1, failed: 0 });
    expect(chunk.failure).toBeUndefined();
  });
});
