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
import { createCalendarAction } from "@/utils/actions/calendar-manage";
import { getActionErrorMessage } from "@/utils/error";
import { CalendarColorSwatches } from "@/components/shell/CalendarColorSwatches";
import { describeManageFailure } from "@/components/shell/calendar-manage-copy";

export function NewCalendarDialog({
  open,
  onOpenChange,
  connectionId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  onCreated: () => void;
}) {
  const { emailAccountId } = useAccount();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | undefined>();
  const { executeAsync, isExecuting } = useAction(
    createCalendarAction.bind(null, emailAccountId),
  );

  const submit = async () => {
    const result = await executeAsync({ connectionId, name, color });
    const failure = describeManageFailure(result?.data);
    if (result?.serverError || result?.validationErrors || failure) {
      toastError({
        description:
          failure ??
          getActionErrorMessage(
            { serverError: result?.serverError },
            { prefix: "Could not create the calendar" },
          ),
      });
      return;
    }
    setName("");
    setColor(undefined);
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New calendar</DialogTitle>
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
            value={name}
            maxLength={100}
            placeholder="Name"
            aria-label="Name"
            onChange={(event) => setName(event.target.value)}
          />
          <CalendarColorSwatches value={color} onChange={setColor} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isExecuting} disabled={!name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
