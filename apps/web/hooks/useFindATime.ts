import useSWR from "swr";
import type { GetFindATimeResponse } from "@/app/api/user/calendar/find-a-time/route";

export function useFindATime({
  attendees,
  from,
  to,
  durationMinutes,
  timezone,
  limit = 12,
  enabled = true,
}: {
  attendees: string[];
  from: Date;
  to: Date;
  durationMinutes: number;
  timezone: string;
  limit?: number;
  enabled?: boolean;
}) {
  const query = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    durationMinutes: String(durationMinutes),
    timezone,
    limit: String(limit),
  });
  for (const attendee of attendees) query.append("attendee", attendee);

  return useSWR<GetFindATimeResponse>(
    enabled ? `/api/user/calendar/find-a-time?${query}` : null,
    { keepPreviousData: true, revalidateOnFocus: false },
  );
}
