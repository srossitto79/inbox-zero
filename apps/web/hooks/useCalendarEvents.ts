import useSWR from "swr";
import type { GetCalendarEventsResponse } from "@/app/api/user/calendar/events/route";

export function useCalendarEvents({
  from,
  to,
  timezone,
  enabled = true,
}: {
  from: Date;
  to: Date;
  timezone: string;
  enabled?: boolean;
}) {
  const query = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    timezone,
  });
  return useSWR<GetCalendarEventsResponse>(
    enabled ? `/api/user/calendar/events?${query}` : null,
    { keepPreviousData: true, refreshInterval: 60_000 },
  );
}
