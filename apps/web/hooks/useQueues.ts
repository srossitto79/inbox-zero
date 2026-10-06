import { useMemo } from "react";
import { useRules } from "@/hooks/useRules";
import {
  buildQueuesFromRules,
  LEGACY_QUEUES,
  type MailQueue,
} from "@/utils/queues";

/**
 * The current account's queues, derived from its rules. Falls back to the
 * legacy hardcoded list while rules are still loading (or unreadable) so the
 * sidebar and list headings don't flash away on first paint.
 */
export function useQueues(): MailQueue[] {
  const { data: rules } = useRules();
  return useMemo(
    () => (rules ? buildQueuesFromRules(rules) : LEGACY_QUEUES),
    [rules],
  );
}
