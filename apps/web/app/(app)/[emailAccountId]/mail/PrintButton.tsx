"use client";

import { PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function PrintButton({
  onPrintMessage,
  onPrintThread,
}: {
  onPrintMessage: () => void;
  /** Set when the thread holds more than one message. */
  onPrintThread?: () => void;
}) {
  if (!onPrintThread) {
    return (
      <Button
        aria-label="Print"
        onClick={onPrintMessage}
        size="iconXs"
        title="Print"
        variant="outline"
      >
        <PrinterIcon className="size-3.5" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Print"
          size="iconXs"
          title="Print"
          variant="outline"
        >
          <PrinterIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onPrintMessage}>
          Print message
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onPrintThread}>
          Print thread
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
