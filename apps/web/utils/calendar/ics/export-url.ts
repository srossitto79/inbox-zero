const EXPORT_PATH = "/api/user/calendar/export";

/**
 * A link to the ICS export route. `from`/`to` are the visible range's local-day
 * instants, which already cover every day the view shows.
 */
export function buildExportUrl({
  from,
  to,
  calendarId,
}: {
  from: Date;
  to: Date;
  calendarId?: string;
}) {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });
  if (calendarId) params.set("calendarId", calendarId);
  return `${EXPORT_PATH}?${params}`;
}
