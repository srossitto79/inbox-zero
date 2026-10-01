import { NextResponse } from "next/server";
import { z } from "zod";
import { withEmailAccount } from "@/utils/middleware";
import { getBackgroundJob } from "@/utils/background-jobs/queries";

export type GetBackgroundJobResponse = Awaited<
  ReturnType<typeof getBackgroundJob>
>;

const paramsSchema = z.object({ jobId: z.string().min(1) });

export const GET = withEmailAccount(
  "user/background-jobs/get",
  async (request, context) => {
    const { jobId } = paramsSchema.parse(await context.params);
    const result = await getBackgroundJob({
      emailAccountId: request.auth.emailAccountId,
      jobId,
    });
    if (!result.job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  },
);
