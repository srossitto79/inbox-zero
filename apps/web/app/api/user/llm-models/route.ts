import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/utils/middleware";
import { normalizeEndpointUrl } from "@/utils/llms/endpoint-url";
import { fetchEndpointModels } from "@/utils/llms/endpoint-models";

const bodySchema = z.object({
  baseUrl: z.string(),
  apiKey: z.string().optional(),
});

export type GetLlmModelsResponse = Awaited<
  ReturnType<typeof fetchEndpointModels>
>;

export const POST = withAuth("user/llm-models", async (request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const baseUrl = parsed.success
    ? normalizeEndpointUrl(parsed.data.baseUrl)
    : null;
  if (!parsed.success || !baseUrl) {
    return NextResponse.json(
      { error: "Invalid endpoint URL" },
      { status: 400 },
    );
  }

  const result = await fetchEndpointModels({
    baseUrl,
    apiKey: parsed.data.apiKey?.trim() || undefined,
  });

  return NextResponse.json(result);
});
