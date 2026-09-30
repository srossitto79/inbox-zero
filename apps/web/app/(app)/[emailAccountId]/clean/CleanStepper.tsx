import { CheckIcon } from "lucide-react";
import { CleanStep } from "@/app/(app)/[emailAccountId]/clean/types";
import { cn } from "@/utils";

const STEPS = [
  { step: CleanStep.INTRO, label: "Start" },
  { step: CleanStep.ARCHIVE_OR_READ, label: "Action" },
  { step: CleanStep.TIME_RANGE, label: "Time range" },
  { step: CleanStep.LABEL_OPTIONS, label: "Keep" },
  { step: CleanStep.FINAL_CONFIRMATION, label: "Confirm" },
];

export function CleanStepper({ step }: { step: number }) {
  return (
    <ol
      aria-label="Progress"
      className="mx-auto flex w-full max-w-2xl items-center px-4"
    >
      {STEPS.map((item, index) => {
        const isDone = item.step < step;
        const isCurrent = item.step === step;
        return (
          <li
            key={item.step}
            aria-current={isCurrent ? "step" : undefined}
            className={cn("flex items-center", index > 0 && "flex-1")}
          >
            {index > 0 && (
              <span
                aria-hidden
                className={cn(
                  "mx-2 h-px flex-1",
                  isDone || isCurrent ? "bg-brand" : "bg-border",
                )}
              />
            )}
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border text-xs font-semibold",
                  isDone && "border-primary bg-primary text-primary-foreground",
                  isCurrent && "border-brand text-brand",
                  !(isDone || isCurrent) &&
                    "border-border text-muted-foreground",
                )}
              >
                {isDone ? <CheckIcon className="size-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  "hidden text-sm sm:inline",
                  isCurrent
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
