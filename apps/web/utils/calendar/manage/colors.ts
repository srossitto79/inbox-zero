// Google's calendar palette. Writing a calendar color in RGB mode makes Google
// pick the nearest palette entry, so only these values round-trip exactly.
export const CALENDAR_COLOR_SWATCHES = [
  { name: "Tomato", value: "#d50000" },
  { name: "Flamingo", value: "#e67c73" },
  { name: "Tangerine", value: "#f4511e" },
  { name: "Banana", value: "#f6bf26" },
  { name: "Sage", value: "#33b679" },
  { name: "Basil", value: "#0b8043" },
  { name: "Peacock", value: "#039be5" },
  { name: "Blueberry", value: "#3f51b5" },
  { name: "Lavender", value: "#7986cb" },
  { name: "Grape", value: "#8e24aa" },
  { name: "Graphite", value: "#616161" },
] as const;

export const CALENDAR_COLOR_VALUES = CALENDAR_COLOR_SWATCHES.map(
  (swatch) => swatch.value,
) as [string, ...string[]];

/** Black or white, whichever reads better on the background. */
export function getForegroundColor(background: string) {
  const hex = background.replace("#", "");
  const [red, green, blue] = [0, 2, 4].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16),
  );
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}
