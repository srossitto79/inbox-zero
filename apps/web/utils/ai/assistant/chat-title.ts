import { z } from "zod";
import prisma from "@/utils/prisma";
import { createGenerateObject } from "@/utils/llms";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import { getModelForUseCase, LlmUseCase } from "@/utils/llms/use-cases";
import type { Logger } from "@/utils/logger";

const TITLE_MAX_LENGTH = 48;
const DESCRIPTION_MAX_LENGTH = 240;
const TITLE_MESSAGE_MAX_LENGTH = 2000;

const chatTitleSchema = z.object({
  title: z
    .string()
    .describe("Short label for the chat session, at most 6 words"),
});

const CHAT_TITLE_INSTRUCTIONS = `You label a chat session in an email assistant's chat history.

Given the user's opening message, write a title for the chat:
- At most 6 words, sentence case
- Capture the user's goal or topic rather than the exact wording
- No surrounding quotes, no trailing punctuation other than a question mark
- If the message is only a greeting or too vague to summarize, use its first meaningful words

Respond with JSON matching the provided schema.`;

/**
 * Names a chat from its first user message: fills the history-list
 * description immediately and generates a title once, never overwriting a
 * rename or a title that already exists.
 */
export async function labelChat({
  chatId,
  user,
  currentName,
  currentDescription,
  logger,
}: {
  chatId: string;
  user: EmailAccountWithAI;
  currentName: string | null;
  currentDescription: string | null;
  logger: Logger;
}): Promise<void> {
  if (currentName && currentDescription) return;

  try {
    const firstMessage = await prisma.chatMessage.findFirst({
      where: { chatId, role: "user" },
      orderBy: { createdAt: "asc" },
      select: { parts: true },
    });
    const text = firstMessage ? getChatMessageText(firstMessage.parts) : "";
    if (!text) return;

    if (!currentDescription) {
      const description = buildChatDescription(text);
      if (description) {
        await prisma.chat.updateMany({
          where: { id: chatId, deletedAt: null, description: null },
          data: { description },
        });
      }
    }

    if (currentName) return;

    const title = await generateChatTitle({ text, user, logger });
    if (!title) return;

    await prisma.chat.updateMany({
      where: { id: chatId, deletedAt: null, name: null },
      data: { name: title },
    });
  } catch (error) {
    logger.warn("Failed to auto-label chat", { error, chatId });
  }
}

async function generateChatTitle({
  text,
  user,
  logger,
}: {
  text: string;
  user: EmailAccountWithAI;
  logger: Logger;
}): Promise<string> {
  try {
    const modelOptions = getModelForUseCase(
      user.user,
      LlmUseCase.ChatTitleGeneration,
    );
    const generateObject = createGenerateObject({
      emailAccount: user,
      label: "chat-title-generation",
      modelOptions,
      promptHardening: { trust: "untrusted", level: "full" },
    });
    const result = await generateObject({
      ...modelOptions,
      schema: chatTitleSchema,
      instructions: CHAT_TITLE_INSTRUCTIONS,
      prompt: `<user_message>\n${text.slice(0, TITLE_MESSAGE_MAX_LENGTH)}\n</user_message>`,
    });

    const title = sanitizeChatTitle(result.object.title);
    if (title) return title;
  } catch (error) {
    logger.warn("Chat title generation failed", { error });
  }

  return sanitizeChatTitle(text);
}

export function sanitizeChatTitle(raw: string): string {
  const collapsed = collapseWhitespace(raw)
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "");
  const title = collapsed.replace(/[.,;:!]+$/u, "");
  return truncateAtWordBoundary(title, TITLE_MAX_LENGTH);
}

export function buildChatDescription(text: string): string | null {
  const collapsed = collapseWhitespace(text);
  if (!collapsed) return null;

  const truncated = truncateAtWordBoundary(collapsed, DESCRIPTION_MAX_LENGTH);
  return truncated.length < collapsed.length ? `${truncated}…` : truncated;
}

function getChatMessageText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";

  return parts
    .filter(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => (part as { text: string }).text)
    .join(" ")
    .trim();
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const slice = text.slice(0, maxLength + 1);
  const lastSpaceIndex = slice.lastIndexOf(" ");
  if (lastSpaceIndex <= 0) return text.slice(0, maxLength);

  return text.slice(0, lastSpaceIndex).trimEnd();
}
