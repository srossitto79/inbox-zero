import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("@/utils/middleware", async () => {
  const { createWithEmailAccountTestMiddleware } = await vi.importActual<
    typeof import("@/__tests__/helpers")
  >("@/__tests__/helpers");

  return createWithEmailAccountTestMiddleware({
    auth: {
      userId: "user-1",
      emailAccountId: "account-1",
      email: "user@example.com",
    },
  });
});

import { GET } from "./route";

const groupByLastUserMessage = prisma.chatMessage
  .groupBy as unknown as ReturnType<typeof vi.fn>;

describe("GET /api/chats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the chat of the latest user message first", async () => {
    prisma.chat.findMany.mockResolvedValue([
      chat("edited-recently", "2026-10-01T09:00:00Z"),
      chat("messaged-recently", "2026-09-30T09:00:00Z"),
      chat("never-messaged", "2026-10-01T08:00:00Z"),
    ] as never);
    groupByLastUserMessage.mockResolvedValue([
      lastUserMessage("edited-recently", "2026-10-01T09:05:00Z"),
      lastUserMessage("messaged-recently", "2026-10-01T11:00:00Z"),
    ]);

    const { chats } = await listChats();

    expect(chats.map((entry: { id: string }) => entry.id)).toEqual([
      "messaged-recently",
      "edited-recently",
      "never-messaged",
    ]);
    expect(chats[0].lastMessageAt).toBe("2026-10-01T11:00:00.000Z");
    expect(chats[2].lastMessageAt).toBe("2026-10-01T08:00:00.000Z");
  });

  it("only looks at messages the user sent, in this account's chats", async () => {
    prisma.chat.findMany.mockResolvedValue([
      chat("a", "2026-10-01T09:00:00Z"),
    ] as never);
    groupByLastUserMessage.mockResolvedValue([]);

    await listChats();

    expect(prisma.chat.findMany.mock.calls[0][0]!.where).toMatchObject({
      emailAccountId: "account-1",
      deletedAt: null,
    });
    expect(groupByLastUserMessage.mock.calls[0][0]).toMatchObject({
      by: ["chatId"],
      where: { role: "user", chatId: { in: ["a"] } },
    });
  });

  it("skips the message lookup when there are no chats", async () => {
    prisma.chat.findMany.mockResolvedValue([] as never);

    expect(await listChats()).toEqual({ chats: [] });
    expect(groupByLastUserMessage).not.toHaveBeenCalled();
  });
});

async function listChats() {
  const response = await GET(new NextRequest("http://localhost/api/chats"), {
    params: Promise.resolve({}),
  });
  return response.json();
}

function chat(id: string, updatedAt: string) {
  return {
    id,
    name: null,
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
  };
}

function lastUserMessage(chatId: string, at: string) {
  return { chatId, _max: { createdAt: new Date(at) } };
}
