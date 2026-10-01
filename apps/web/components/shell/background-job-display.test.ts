import { describe, expect, it } from "vitest";
import {
  getBackgroundJobPath,
  getBackgroundJobStatusText,
} from "@/components/shell/background-job-display";

const base = {
  progressDone: 0,
  result: null,
  error: null,
  cancelRequested: false,
  nextRunAt: null,
};

describe("background job display", () => {
  it("links a chat reply to its chat", () => {
    expect(
      getBackgroundJobPath("account-1", {
        kind: "CHAT_REPLY",
        payload: { chatId: "chat 1" },
      }),
    ).toBe("/account-1/assistant?chatId=chat%201");
  });

  it("links a chat reply without a chat id to the assistant", () => {
    expect(
      getBackgroundJobPath("account-1", { kind: "CHAT_REPLY", payload: {} }),
    ).toBe("/account-1/assistant");
  });

  it("describes a chat reply by whether it is running", () => {
    expect(
      getBackgroundJobStatusText({
        ...base,
        kind: "CHAT_REPLY",
        status: "RUNNING",
      }),
    ).toBe("Generating");
    expect(
      getBackgroundJobStatusText({
        ...base,
        kind: "CHAT_REPLY",
        status: "FAILED",
      }),
    ).toBe("Failed");
  });

  it("shows the failed count of a bulk run", () => {
    expect(
      getBackgroundJobStatusText({
        ...base,
        kind: "BULK_RULES",
        status: "RUNNING",
        progressDone: 5,
        result: { failed: 2 },
      }),
    ).toBe("5 processed, 2 failed");
  });

  it("shows the error and counts of a failed bulk run", () => {
    expect(
      getBackgroundJobStatusText({
        ...base,
        kind: "BULK_RULES",
        status: "FAILED",
        progressDone: 1,
        result: { failed: 1 },
        error: "LLM failed",
      }),
    ).toBe("Failed, 1 processed, 1 failed. LLM failed");
  });
});
