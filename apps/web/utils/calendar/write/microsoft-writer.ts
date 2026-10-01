import type {
  CalendarEventWriter,
  WriteFailure,
} from "@/utils/calendar/write/types";

const unsupported: WriteFailure = {
  ok: false,
  reason: "unsupported",
  message: "Outlook events are read-only",
};

/** Outlook writes are not built yet; every call answers the same way. */
export function createMicrosoftEventWriter(): CalendarEventWriter {
  return {
    createEvent: async () => unsupported,
    updateEvent: async () => unsupported,
    moveEvent: async () => unsupported,
    deleteEvent: async () => unsupported,
    respondToEvent: async () => unsupported,
    setReminders: async () => unsupported,
    fetchEvent: async () => unsupported,
  };
}
