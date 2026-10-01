import useSWR from "swr";
import type { GetCalendarPreferencesResponse } from "@/app/api/user/calendar/preferences/route";
import {
  type CalendarPreferences,
  DEFAULT_CALENDAR_PREFERENCES,
} from "@/utils/calendar/preferences/preferences";

/** Preferences resolve to defaults until the stored values load. */
export function useCalendarPreferences() {
  const { data, error, isLoading, mutate } =
    useSWR<GetCalendarPreferencesResponse>("/api/user/calendar/preferences");

  const preferences: CalendarPreferences =
    data?.preferences ?? DEFAULT_CALENDAR_PREFERENCES;

  return { preferences, error, isLoading, mutate };
}
