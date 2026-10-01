import { toWallClock } from "@/utils/calendar/zoned-time";

const SCAN_STEP_MS = 6 * 3_600_000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

type Transition = { instantMs: number; offsetFrom: number; offsetTo: number };

/**
 * VTIMEZONE lines for an IANA zone, derived from the transitions of `year`.
 * Rules are expressed as yearly "nth weekday of the month" observances, which
 * is how every current DST regime is defined; zones without transitions get a
 * single fixed observance.
 */
export function buildVTimezone(timeZone: string, year: number): string[] {
  const transitions = findTransitions(timeZone, year);
  const lines = ["BEGIN:VTIMEZONE", `TZID:${timeZone}`];

  if (transitions.length === 0) {
    const offset = getOffsetMinutes(Date.UTC(year, 0, 1), timeZone);
    lines.push(
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      `TZOFFSETFROM:${formatOffset(offset)}`,
      `TZOFFSETTO:${formatOffset(offset)}`,
      "END:STANDARD",
    );
  }

  for (const transition of transitions) {
    // The observance start is written in the offset that applies before it.
    const local = new Date(
      transition.instantMs + transition.offsetFrom * 60_000,
    );
    const kind =
      transition.offsetTo > transition.offsetFrom ? "DAYLIGHT" : "STANDARD";
    lines.push(
      `BEGIN:${kind}`,
      `DTSTART:${formatLocal(local)}`,
      `RRULE:FREQ=YEARLY;BYMONTH=${local.getUTCMonth() + 1};BYDAY=${getByDay(local)}`,
      `TZOFFSETFROM:${formatOffset(transition.offsetFrom)}`,
      `TZOFFSETTO:${formatOffset(transition.offsetTo)}`,
      `END:${kind}`,
    );
  }

  lines.push("END:VTIMEZONE");
  return lines;
}

function findTransitions(timeZone: string, year: number): Transition[] {
  const transitions: Transition[] = [];
  const end = Date.UTC(year + 1, 0, 1);
  let previousMs = Date.UTC(year, 0, 1);
  let previousOffset = getOffsetMinutes(previousMs, timeZone);

  for (let ms = previousMs + SCAN_STEP_MS; ms <= end; ms += SCAN_STEP_MS) {
    const offset = getOffsetMinutes(ms, timeZone);
    if (offset !== previousOffset) {
      transitions.push({
        instantMs: refineTransition(previousMs, ms, previousOffset, timeZone),
        offsetFrom: previousOffset,
        offsetTo: offset,
      });
    }
    previousMs = ms;
    previousOffset = offset;
  }
  return transitions;
}

/** First minute at which the offset differs from `offsetBefore`. */
function refineTransition(
  low: number,
  high: number,
  offsetBefore: number,
  timeZone: string,
) {
  let lo = low;
  let hi = high;
  while (hi - lo > 60_000) {
    const mid = Math.max(
      lo + 60_000,
      lo + Math.floor((hi - lo) / 120_000) * 60_000,
    );
    if (getOffsetMinutes(mid, timeZone) === offsetBefore) lo = mid;
    else hi = mid;
  }
  return hi;
}

function getOffsetMinutes(instantMs: number, timeZone: string) {
  const wall = toWallClock(new Date(instantMs), timeZone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    0,
  );
  return Math.round((asUtc - Math.floor(instantMs / 60_000) * 60_000) / 60_000);
}

function getByDay(local: Date) {
  const day = local.getUTCDate();
  const daysInMonth = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const nth = day + 7 > daysInMonth ? -1 : Math.ceil(day / 7);
  return `${nth}${WEEKDAYS[local.getUTCDay()]}`;
}

function formatOffset(minutes: number) {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;
}

function formatLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}
