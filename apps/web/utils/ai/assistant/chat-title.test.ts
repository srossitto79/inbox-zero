import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import { createScopedLogger } from "@/utils/logger";
import {
  buildChatDescription,
  labelChat,
  sanitizeChatTitle,
} from "./chat-title";

const { mockGenerateObject } = vi.hoisted(() => ({
  mockGenerateObject: vi.fn(),
}));

vi.mock("@/utils/prisma");
vi.mock("@/utils/llms", () => ({
  createGenerateObject: () => mockGenerateObject,
}));
vi.mock("@/utils/llms/use-cases", () => ({
  LlmUseCase: { ChatTitleGeneration: "chat-title-generation" },
  getModelForUseCase: () => ({ provider: "openrouter", modelName: "test" }),
}));

const logger = createScopedLogger("chat-title-test");

function getUser() {
  return {
    id: "email-account-id",
    userId: "user-1",
    email: "user@test.com",
    sensitiveDataPolicy: null,
    user: {},
  } as unknown as EmailAccountWithAI;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateObject.mockReset();
  prisma.chat.updateMany.mockResolvedValue({ count: 1 });
});

describe("labelChat", () => {
  it("fills the missing description and generates a title from the first message", async () => {
    prisma.chatMessage.findFirst.mockResolvedValue({
      parts: [
        {
          type: "text",
          text: "Unsubscribe me from newsletters and promo spam",
        },
      ],
    } as never);
    mockGenerateObject.mockResolvedValue({
      object: { title: "Unsubscribe from newsletters" },
    });

    await labelChat({
      chatId: "chat-1",
      user: getUser(),
      currentName: null,
      currentDescription: null,
      logger,
    });

    expect(prisma.chatMessage.findFirst).toHaveBeenCalledWith({
      where: { chatId: "chat-1", role: "user" },
      orderBy: { createdAt: "asc" },
      select: { parts: true },
    });
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
    expect(prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { id: "chat-1", deletedAt: null, description: null },
      data: {
        description: "Unsubscribe me from newsletters and promo spam",
      },
    });
    expect(prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { id: "chat-1", deletedAt: null, name: null },
      data: { name: "Unsubscribe from newsletters" },
    });
  });

  it("does not call the model when the chat already has a name", async () => {
    prisma.chatMessage.findFirst.mockResolvedValue({
      parts: [{ type: "text", text: "hello there" }],
    } as never);

    await labelChat({
      chatId: "chat-1",
      user: getUser(),
      currentName: "Renamed by user",
      currentDescription: null,
      logger,
    });

    expect(mockGenerateObject).not.toHaveBeenCalled();
    expect(prisma.chat.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { id: "chat-1", deletedAt: null, description: null },
      data: { description: "hello there" },
    });
  });

  it("skips database work when name and description already exist", async () => {
    await labelChat({
      chatId: "chat-1",
      user: getUser(),
      currentName: "Existing title",
      currentDescription: "Existing description",
      logger,
    });

    expect(prisma.chatMessage.findFirst).not.toHaveBeenCalled();
    expect(mockGenerateObject).not.toHaveBeenCalled();
    expect(prisma.chat.updateMany).not.toHaveBeenCalled();
  });

  it("falls back to the first message when title generation fails", async () => {
    prisma.chatMessage.findFirst.mockResolvedValue({
      parts: [
        {
          type: "text",
          text: "Can you archive all newsletters from last month.",
        },
      ],
    } as never);
    mockGenerateObject.mockRejectedValue(new Error("no model"));

    await labelChat({
      chatId: "chat-1",
      user: getUser(),
      currentName: null,
      currentDescription: null,
      logger,
    });

    expect(prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { id: "chat-1", deletedAt: null, name: null },
      data: { name: "Can you archive all newsletters from last month" },
    });
  });

  it("does nothing when the chat has no user message with text", async () => {
    prisma.chatMessage.findFirst.mockResolvedValue(null);

    await labelChat({
      chatId: "chat-1",
      user: getUser(),
      currentName: null,
      currentDescription: null,
      logger,
    });

    expect(mockGenerateObject).not.toHaveBeenCalled();
    expect(prisma.chat.updateMany).not.toHaveBeenCalled();

    prisma.chatMessage.findFirst.mockResolvedValue({
      parts: [{ type: "file" }],
    } as never);

    await labelChat({
      chatId: "chat-1",
      user: getUser(),
      currentName: null,
      currentDescription: null,
      logger,
    });

    expect(mockGenerateObject).not.toHaveBeenCalled();
    expect(prisma.chat.updateMany).not.toHaveBeenCalled();
  });

  it("does not throw when the database write fails", async () => {
    prisma.chatMessage.findFirst.mockRejectedValue(new Error("db down"));

    await expect(
      labelChat({
        chatId: "chat-1",
        user: getUser(),
        currentName: null,
        currentDescription: null,
        logger,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("sanitizeChatTitle", () => {
  it("collapses whitespace and strips surrounding quotes and trailing punctuation", () => {
    expect(sanitizeChatTitle('  "Unsubscribe   from newsletters." ')).toBe(
      "Unsubscribe from newsletters",
    );
  });

  it("truncates at a word boundary within the length limit", () => {
    const title = sanitizeChatTitle(
      "please help me organise the entire backlog of unread newsletters",
    );

    expect(title).toBe("please help me organise the entire backlog of");
    expect(title.length).toBeLessThanOrEqual(48);
  });

  it("keeps question marks", () => {
    expect(sanitizeChatTitle("Which invoice still needs paying?")).toBe(
      "Which invoice still needs paying?",
    );
  });

  it("returns an empty string when only punctuation remains", () => {
    expect(sanitizeChatTitle('"..."')).toBe("");
  });
});

describe("buildChatDescription", () => {
  it("collapses the message into a single line", () => {
    expect(
      buildChatDescription("Clean up my inbox.\nThen   draft replies"),
    ).toBe("Clean up my inbox. Then draft replies");
  });

  it("truncates long messages with an ellipsis at a word boundary", () => {
    const description = buildChatDescription("word ".repeat(70).trim());

    expect(description).toMatch(/^(\w+ )+\w+…$/);
    expect(description!.length).toBeLessThanOrEqual(241);
  });

  it("returns null for empty input", () => {
    expect(buildChatDescription("   \n  ")).toBeNull();
  });
});
