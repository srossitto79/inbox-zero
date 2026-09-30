import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getLastJob } from "@/app/(app)/[emailAccountId]/clean/helpers";
import { ConfirmationStep } from "@/app/(app)/[emailAccountId]/clean/ConfirmationStep";
import { Card } from "@/components/ui/card";
import { Loading } from "@/components/Loading";
import { PageHeading } from "@/components/Typography";
import { CleanStepper } from "@/app/(app)/[emailAccountId]/clean/CleanStepper";
import { CleanStep } from "@/app/(app)/[emailAccountId]/clean/types";
import { prefixPath } from "@/utils/path";
import { checkUserOwnsEmailAccount } from "@/utils/email-account";

export default async function CleanPage({
  params,
}: {
  params: Promise<{ emailAccountId: string }>;
}) {
  const { emailAccountId } = await params;
  await checkUserOwnsEmailAccount({ emailAccountId });

  const lastJob = await getLastJob({ emailAccountId });
  if (!lastJob) redirect(prefixPath(emailAccountId, "/clean/onboarding"));

  return (
    <div className="px-4 pt-6">
      <div className="mx-auto max-w-2xl">
        <PageHeading>Deep Clean</PageHeading>
      </div>
      <div className="mt-5">
        <CleanStepper step={CleanStep.FINAL_CONFIRMATION} />
      </div>
      <Card className="mx-auto my-6 max-w-2xl p-6 sm:p-8">
        <Suspense fallback={<Loading />}>
          <ConfirmationStep
            showFooter
            action={lastJob.action}
            timeRange={lastJob.daysOld}
            instructions={lastJob.instructions ?? undefined}
            skips={{
              reply: lastJob.skipReply ?? true,
              starred: lastJob.skipStarred ?? true,
              calendar: lastJob.skipCalendar ?? true,
              receipt: lastJob.skipReceipt ?? false,
              attachment: lastJob.skipAttachment ?? false,
            }}
            reuseSettings={true}
          />
        </Suspense>
      </Card>
    </div>
  );
}
