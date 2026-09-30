import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogicalOperator } from "@/generated/prisma/enums";
import { ConditionType } from "@/utils/config";
import { aiChooseRule } from "@/utils/ai/choose-rule/ai-choose-rule";
import { createTestLogger, getEmailAccount } from "@/__tests__/helpers";
import type { ParsedMessage } from "@/utils/types";
import { describeStaticMismatch, dryRunRuleOnMessage } from "./dry-run";

vi.mock("@/utils/prisma");
vi.mock("@/utils/ai/choose-rule/ai-choose-rule", () => ({
  aiChooseRule: vi.fn(),
}));

const logger = createTestLogger();
const emailAccount = getEmailAccount();

describe("dryRunRuleOnMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("matches on static conditions without calling the AI", async () => {
    const outcome = await dryRunRuleOnMessage({
      rule: {
        name: "Newsletters",
        conditions: [{ type: ConditionType.STATIC, from: "news@example.com" }],
      },
      message: getMessage({ from: "News <news@example.com>" }),
      isThread: false,
      emailAccount,
      logger,
    });

    expect(outcome).toMatchObject({ matched: true, method: "static" });
    expect(aiChooseRule).not.toHaveBeenCalled();
  });

  it("explains which static field did not match", async () => {
    const outcome = await dryRunRuleOnMessage({
      rule: {
        name: "Newsletters",
        conditions: [
          { type: ConditionType.STATIC, from: "news@example.com" },
          { type: ConditionType.STATIC, subject: "Weekly" },
        ],
      },
      message: getMessage({ from: "news@example.com", subject: "Invoice" }),
      isThread: false,
      emailAccount,
      logger,
    });

    expect(outcome).toEqual({
      matched: false,
      method: "skipped",
      reason: "Does not match subject",
    });
    expect(aiChooseRule).not.toHaveBeenCalled();
  });

  it("asks the AI with only the draft rule and reports its verdict", async () => {
    vi.mocked(aiChooseRule).mockResolvedValue({
      rules: [{ rule: { name: "Receipts", instructions: "Receipts" } }],
      reason: "  Order confirmation  ",
    });

    const outcome = await dryRunRuleOnMessage({
      rule: {
        name: "Receipts",
        conditions: [{ type: ConditionType.AI, instructions: "Receipts" }],
      },
      message: getMessage(),
      isThread: false,
      emailAccount,
      logger,
    });

    expect(outcome).toEqual({
      matched: true,
      method: "ai",
      reason: "Order confirmation",
    });
    expect(aiChooseRule).toHaveBeenCalledWith(
      expect.objectContaining({
        rules: [{ name: "Receipts", instructions: "Receipts" }],
      }),
    );
  });

  it("reports a rejection from the AI", async () => {
    vi.mocked(aiChooseRule).mockResolvedValue({
      rules: [],
      reason: "This is a personal note",
    });

    const outcome = await dryRunRuleOnMessage({
      rule: {
        name: "Receipts",
        conditions: [{ type: ConditionType.AI, instructions: "Receipts" }],
      },
      message: getMessage(),
      isThread: false,
      emailAccount,
      logger,
    });

    expect(outcome).toEqual({
      matched: false,
      method: "ai",
      reason: "This is a personal note",
    });
  });

  it("does not call the AI when the static part of an AND rule fails", async () => {
    const outcome = await dryRunRuleOnMessage({
      rule: {
        name: "Receipts",
        conditionalOperator: LogicalOperator.AND,
        conditions: [
          { type: ConditionType.AI, instructions: "Receipts" },
          { type: ConditionType.STATIC, from: "shop@example.com" },
        ],
      },
      message: getMessage({ from: "friend@example.com" }),
      isThread: false,
      emailAccount,
      logger,
    });

    expect(outcome.matched).toBe(false);
    expect(outcome.reason).toBe("Does not match sender");
    expect(aiChooseRule).not.toHaveBeenCalled();
  });

  it("falls back to the AI when an OR rule has no static match", async () => {
    vi.mocked(aiChooseRule).mockResolvedValue({ rules: [], reason: "" });

    const outcome = await dryRunRuleOnMessage({
      rule: {
        name: "Receipts",
        conditionalOperator: LogicalOperator.OR,
        conditions: [
          { type: ConditionType.AI, instructions: "Receipts" },
          { type: ConditionType.STATIC, from: "shop@example.com" },
        ],
      },
      message: getMessage({ from: "friend@example.com" }),
      isThread: false,
      emailAccount,
      logger,
    });

    expect(aiChooseRule).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      matched: false,
      method: "ai",
      reason: "Does not match the description",
    });
  });

  it("leaves replies alone when the rule does not run on threads", async () => {
    const outcome = await dryRunRuleOnMessage({
      rule: {
        name: "Newsletters",
        runOnThreads: false,
        conditions: [{ type: ConditionType.STATIC, from: "news@example.com" }],
      },
      message: getMessage({ from: "news@example.com" }),
      isThread: true,
      emailAccount,
      logger,
    });

    expect(outcome).toEqual({
      matched: false,
      method: "skipped",
      reason: "Reply in a conversation",
    });
    expect(aiChooseRule).not.toHaveBeenCalled();
  });

  it("evaluates replies when the rule runs on threads", async () => {
    const outcome = await dryRunRuleOnMessage({
      rule: {
        name: "Newsletters",
        runOnThreads: true,
        conditions: [{ type: ConditionType.STATIC, from: "news@example.com" }],
      },
      message: getMessage({ from: "news@example.com" }),
      isThread: true,
      emailAccount,
      logger,
    });

    expect(outcome.matched).toBe(true);
  });

  it("truncates long AI reasons", async () => {
    vi.mocked(aiChooseRule).mockResolvedValue({
      rules: [],
      reason: "x".repeat(500),
    });

    const outcome = await dryRunRuleOnMessage({
      rule: {
        name: "Receipts",
        conditions: [{ type: ConditionType.AI, instructions: "Receipts" }],
      },
      message: getMessage(),
      isThread: false,
      emailAccount,
      logger,
    });

    expect(outcome.reason).toHaveLength(200);
  });
});

describe("describeStaticMismatch", () => {
  it("lists every failing field", () => {
    const reason = describeStaticMismatch({
      fields: { from: "a@example.com", subject: "Weekly", body: "hello" },
      message: getMessage({ from: "b@example.com", subject: "Invoice" }),
      logger,
    });

    expect(reason).toBe("Does not match sender, subject, body");
  });

  it("reports missing conditions", () => {
    expect(
      describeStaticMismatch({ fields: {}, message: getMessage(), logger }),
    ).toBe("No conditions to match");
  });
});

function getMessage({
  from = "sender@example.com",
  subject = "Hello",
}: {
  from?: string;
  subject?: string;
} = {}): ParsedMessage {
  return {
    id: "message-1",
    threadId: "thread-1",
    historyId: "1",
    snippet: "",
    inline: [],
    internalDate: String(Date.now()),
    textPlain: "Some content",
    headers: {
      from,
      to: "me@example.com",
      subject,
      date: new Date().toISOString(),
    },
  } as unknown as ParsedMessage;
}
