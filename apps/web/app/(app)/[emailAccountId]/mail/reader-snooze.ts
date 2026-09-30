import { getSnoozePresets } from "@/app/(app)/[emailAccountId]/mail/snooze-command-palette";

const READER_PRESET_IDS = [
  "this-afternoon",
  "tomorrow-morning",
  "this-weekend",
  "next-week",
];

/** The command palette's presets, cut down to the ones the reader offers. */
export function getReaderSnoozePresets(now: Date) {
  return getSnoozePresets(now).filter((preset) =>
    READER_PRESET_IDS.includes(preset.id),
  );
}
