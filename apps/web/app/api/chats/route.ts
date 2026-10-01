import { NextResponse } from "next/server";
import prisma from "@/utils/prisma";
import { withEmailAccount } from "@/utils/middleware";

export type GetChatsResponse = Awaited<ReturnType<typeof getChats>>;

export const GET = withEmailAccount("chats", async (request) => {
  const emailAccountId = request.auth.emailAccountId;
  const result = await getChats({ emailAccountId });
  return NextResponse.json(result);
});

async function getChats({ emailAccountId }: { emailAccountId: string }) {
  const chats = await prisma.chat.findMany({
    where: {
      emailAccountId,
      deletedAt: null,
    },
    orderBy: { updatedAt: "desc" },
  });
  if (chats.length === 0) return { chats: [] };

  // A chat's own updatedAt does not move when messages are added to it.
  const lastUserMessages = await prisma.chatMessage.groupBy({
    by: ["chatId"],
    where: { role: "user", chatId: { in: chats.map((chat) => chat.id) } },
    _max: { createdAt: true },
  });
  const lastUserMessageAt = new Map(
    lastUserMessages.map((entry) => [entry.chatId, entry._max.createdAt]),
  );

  return {
    chats: chats
      .map((chat) => ({
        ...chat,
        lastMessageAt: lastUserMessageAt.get(chat.id) ?? chat.updatedAt,
      }))
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()),
  };
}
