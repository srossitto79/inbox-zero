import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import prisma from "@/utils/prisma";
import { getLlmStatus } from "@/app/api/user/llm-status/llm-status";

export type GetLlmStatusResponse = Awaited<ReturnType<typeof getLlmStatus>>;

export const GET = withAuth("user/llm-status", async (request) => {
  const user = await prisma.user.findUnique({
    where: { id: request.auth.userId },
    select: {
      aiProvider: true,
      aiModel: true,
      aiApiKey: true,
      aiBaseUrl: true,
    },
  });

  const result = await getLlmStatus({
    aiProvider: user?.aiProvider ?? null,
    aiModel: user?.aiModel ?? null,
    aiApiKey: user?.aiApiKey ?? null,
    aiBaseUrl: user?.aiBaseUrl ?? null,
  });

  return NextResponse.json(result);
});
