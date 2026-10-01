import { NextResponse } from "next/server";
import { z } from "zod";
import { withEmailAccount } from "@/utils/middleware";
import {
  buildIcsEvent,
  buildIcsFooter,
  buildIcsHeader,
  buildIcsTimezones,
} from "@/utils/calendar/ics/build-ics";
import {
  type IcsExportSelection,
  loadIcsExport,
} from "@/utils/calendar/ics/load-export-events";

const BATCH_SIZE = 200;
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

const isoDate = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const querySchema = z
  .object({
    eventId: z.string().min(1).optional(),
    calendarId: z.string().min(1).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine(({ from, to }) => Boolean(from) === Boolean(to), {
    message: "Provide both start and end",
  })
  .refine(({ from, to }) => !from || !to || to > from, {
    message: "End must be after start",
  })
  .refine(
    ({ from, to }) =>
      !from || !to || to.getTime() - from.getTime() <= MAX_RANGE_MS,
    { message: "Date range is too large" },
  )
  .refine(
    ({ eventId, calendarId, from }) =>
      eventId ? !calendarId && !from : Boolean(calendarId || from),
    { message: "Choose an event, a calendar or a date range" },
  );

export const GET = withEmailAccount("user/calendar/export", async (request) => {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { eventId, calendarId, from, to } = parsed.data;
  const selection: IcsExportSelection = eventId
    ? { type: "event", eventId }
    : calendarId
      ? { type: "calendar", calendarId, from, to }
      : { type: "range", from: from as Date, to: to as Date };

  const exported = await loadIcsExport({
    emailAccountId: request.auth.emailAccountId,
    selection,
  });
  if (!exported) {
    return NextResponse.json({ error: "Nothing to export" }, { status: 404 });
  }

  const now = new Date();
  const encoder = new TextEncoder();
  const chunks = function* () {
    yield [
      ...buildIcsHeader(exported.name),
      ...buildIcsTimezones(exported.events),
    ];
    for (let index = 0; index < exported.events.length; index += BATCH_SIZE) {
      yield exported.events
        .slice(index, index + BATCH_SIZE)
        .flatMap((event) => buildIcsEvent(event, now));
    }
    yield buildIcsFooter();
  };

  const iterator = chunks();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`${next.value.join("\r\n")}\r\n`));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${toFileName(exported.name)}.ics"`,
      "Cache-Control": "no-store",
      ...(exported.truncated ? { "X-Export-Truncated": "true" } : {}),
    },
  });
});

function toFileName(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return slug || "calendar";
}
