"use client";

import { useCallback } from "react";
import { type KeyedMutator, useSWRConfig } from "swr";
import type { GetCalendarEventsResponse } from "@/app/api/user/calendar/events/route";
import { toastError, toastUndo } from "@/components/Toast";
import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  moveCalendarEventAction,
  respondToCalendarEventAction,
  updateCalendarEventAction,
} from "@/utils/actions/calendar-event";
import type {
  CreateCalendarEventBody,
  UpdateCalendarEventBody,
} from "@/utils/actions/calendar-event.validation";
import { eventToRestorePayload } from "@/utils/calendar/event-editor-state";
import {
  removeEvent,
  setEventTimes,
  setSelfResponse,
} from "@/utils/calendar/optimistic-events";
import { assertActionSucceeded } from "@/utils/error";

type CalendarEvent = GetCalendarEventsResponse["events"][number];

const EVENTS_KEY_PREFIX = "/api/user/calendar/events";
const EVENT_CHANGED = "Event changed";

export type SaveOutcome = "saved" | "conflict" | "failed";

export function useCalendarEventMutations({
  emailAccountId,
  timezone,
  mutateEvents,
}: {
  emailAccountId: string;
  timezone: string;
  mutateEvents: KeyedMutator<GetCalendarEventsResponse>;
}) {
  const { mutate } = useSWRConfig();

  const revalidate = useCallback(
    () =>
      mutate(
        (key) => typeof key === "string" && key.startsWith(EVENTS_KEY_PREFIX),
      ),
    [mutate],
  );

  // Shows the change at once and puts the list back when the write fails.
  const applyOptimistically = useCallback(
    async ({
      optimistic,
      write,
    }: {
      optimistic: (events: CalendarEvent[]) => CalendarEvent[];
      write: () => Promise<unknown>;
    }) => {
      try {
        await mutateEvents(
          async (current) => {
            await write();
            return current;
          },
          {
            optimisticData: (current) =>
              current
                ? { ...current, events: optimistic(current.events) }
                : (current as never),
            rollbackOnError: true,
            populateCache: false,
            revalidate: true,
          },
        );
        return true;
      } catch (error) {
        toastError({ description: getMessage(error) });
        await revalidate();
        return false;
      }
    },
    [mutateEvents, revalidate],
  );

  const create = useCallback(
    async (payload: CreateCalendarEventBody): Promise<SaveOutcome> => {
      try {
        const result = await createCalendarEventAction(emailAccountId, payload);
        assertActionSucceeded(result);
        await revalidate();
        return "saved";
      } catch (error) {
        toastError({ description: getMessage(error) });
        return "failed";
      }
    },
    [emailAccountId, revalidate],
  );

  const update = useCallback(
    async (payload: UpdateCalendarEventBody): Promise<SaveOutcome> => {
      try {
        const result = await updateCalendarEventAction(emailAccountId, payload);
        assertActionSucceeded(result);
        await revalidate();
        if (result?.data?.status === "conflict") {
          toastError({ description: EVENT_CHANGED });
          return "conflict";
        }
        return "saved";
      } catch (error) {
        toastError({ description: getMessage(error) });
        return "failed";
      }
    },
    [emailAccountId, revalidate],
  );

  const moveTimed = useCallback(
    (event: CalendarEvent, times: { start: Date; end: Date }) =>
      applyOptimistically({
        optimistic: (events) =>
          setEventTimes(events, event, {
            start: times.start.toISOString(),
            end: times.end.toISOString(),
          }),
        write: async () => {
          const result = await moveCalendarEventAction(emailAccountId, {
            calendarId: event.calendarId,
            providerEventId: event.providerEventId,
            newStart: times.start.toISOString(),
          });
          throwUnlessSaved(result);
        },
      }),
    [applyOptimistically, emailAccountId],
  );

  const moveAllDay = useCallback(
    (event: CalendarEvent, dates: { startDate: string; endDate: string }) =>
      applyOptimistically({
        optimistic: (events) =>
          setEventTimes(events, event, {
            start: dates.startDate,
            end: dates.endDate,
          }),
        write: async () => {
          const result = await moveCalendarEventAction(emailAccountId, {
            calendarId: event.calendarId,
            providerEventId: event.providerEventId,
            newStart: dates.startDate,
          });
          throwUnlessSaved(result);
        },
      }),
    [applyOptimistically, emailAccountId],
  );

  const resizeTimed = useCallback(
    (event: CalendarEvent, end: Date) =>
      applyOptimistically({
        optimistic: (events) =>
          setEventTimes(events, event, {
            start: event.start,
            end: end.toISOString(),
          }),
        write: async () => {
          const result = await updateCalendarEventAction(emailAccountId, {
            calendarId: event.calendarId,
            providerEventId: event.providerEventId,
            timing: {
              isAllDay: false,
              start: event.start,
              end: end.toISOString(),
              timeZone: event.timezone ?? timezone,
            },
          });
          throwUnlessSaved(result);
        },
      }),
    [applyOptimistically, emailAccountId, timezone],
  );

  const respond = useCallback(
    (event: CalendarEvent, response: "accepted" | "declined" | "tentative") =>
      applyOptimistically({
        optimistic: (events) => setSelfResponse(events, event, response),
        write: async () => {
          const result = await respondToCalendarEventAction(emailAccountId, {
            calendarId: event.calendarId,
            providerEventId: event.providerEventId,
            response,
          });
          throwUnlessSaved(result);
        },
      }),
    [applyOptimistically, emailAccountId],
  );

  const remove = useCallback(
    async (event: CalendarEvent) => {
      const deleted = await applyOptimistically({
        optimistic: (events) => removeEvent(events, event),
        write: async () => {
          const result = await deleteCalendarEventAction(emailAccountId, {
            calendarId: event.calendarId,
            providerEventId: event.providerEventId,
          });
          assertActionSucceeded(result);
        },
      });
      if (!deleted) return false;

      toastUndo({
        message: "Event deleted",
        onUndo: async () => {
          try {
            const result = await createCalendarEventAction(
              emailAccountId,
              eventToRestorePayload(event, timezone),
            );
            assertActionSucceeded(result);
          } catch (error) {
            toastError({ description: getMessage(error) });
          }
          await revalidate();
        },
      });
      return true;
    },
    [applyOptimistically, emailAccountId, revalidate, timezone],
  );

  return {
    create,
    update,
    moveTimed,
    moveAllDay,
    resizeTimed,
    respond,
    remove,
  };
}

function throwUnlessSaved(
  result:
    | (Parameters<typeof assertActionSucceeded>[0] & {
        data?: { status?: string };
      })
    | undefined,
) {
  assertActionSucceeded(result);
  if (result?.data?.status === "conflict") throw new Error(EVENT_CHANGED);
}

function getMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Could not save the event";
}
