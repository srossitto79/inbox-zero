import { NextResponse } from "next/server";
import { withEmailAccount } from "@/utils/middleware";
import { getBackgroundJobs } from "@/utils/background-jobs/queries";

export type GetBackgroundJobsResponse = Awaited<
  ReturnType<typeof getBackgroundJobs>
>;

export const GET = withEmailAccount("user/background-jobs", async (request) => {
  const result = await getBackgroundJobs({
    emailAccountId: request.auth.emailAccountId,
  });
  return NextResponse.json(result);
});
