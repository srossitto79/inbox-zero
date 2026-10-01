"use client";

import { useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { toastError } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAccount } from "@/providers/EmailAccountProvider";
import { updateCalendarAction } from "@/utils/actions/calendar-manage";
import { getActionErrorMessage } from "@/utils/error";
import { describeManageFailure } from "@/components/shell/calendar-manage-copy";

export function RenameCalendarDialog({
  calendar,
  onOpenChange,
  onRenamed,
}: {
  calendar: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
}) {
  const { emailAccountId } = useAccount();
  const [draft, setDraft] = useState<{ id: string; name: string } | null>(null);
  const name = draft?.id === calendar?.id ? draft?.name : calendar?.name;
  const { executeAsync, isExecuting } = useAction(
    updateCalendarAction.bind(null, emailAccountId),
  );

  const submit = async () => {
    if (!calendar || !name) return;
    const result = await executeAsync({ calendarId: calendar.id, name });
    const failure = describeManageFailure(result?.data);
    if (result?.serverError || result?.validationErrors || failure) {
      toastError({
        description:
          failure ??
          getActionErrorMessage(
            { serverError: result?.serverError },
            { prefix: "Could not rename the calendar" },
          ),
      });
      return;
    }
    onOpenChange(false);
    onRenamed();
  };

  return (
    <Dialog open={calendar !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename calendar</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            value={name ?? ""}
            maxLength={100}
            aria-label="Name"
            onChange={(event) =>
              setDraft({ id: calendar?.id ?? "", name: event.target.value })
            }
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isExecuting}
              disabled={!name?.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
