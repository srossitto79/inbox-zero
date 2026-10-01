export type DownloadSample = { at: number; count: number };

const WINDOW_MS = 10 * 60_000;
const MIN_SPAN_MS = 30_000;

export function pushDownloadSample(
  samples: DownloadSample[],
  sample: DownloadSample,
): DownloadSample[] {
  const last = samples.at(-1);
  if (last && last.count === sample.count && sample.at - last.at < 5000) {
    return samples;
  }
  return [...samples, sample].filter(
    (entry) => sample.at - entry.at <= WINDOW_MS,
  );
}

/** Threads per minute over the recent window, or null until there is enough signal. */
export function downloadRatePerMinute(
  samples: DownloadSample[],
): number | null {
  const first = samples.at(0);
  const last = samples.at(-1);
  if (!first || !last || last.at - first.at < MIN_SPAN_MS) return null;
  const gained = last.count - first.count;
  if (gained <= 0) return null;
  return (gained / (last.at - first.at)) * 60_000;
}

export function downloadRemainingMinutes(
  remaining: number,
  ratePerMinute: number | null,
): number | null {
  if (ratePerMinute === null || remaining <= 0) return null;
  return Math.ceil(remaining / ratePerMinute);
}

/** Time until a scheduled retry, rounded for a status line. */
export function formatWait(ms: number): string {
  if (ms <= 0) return "now";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `in ${seconds} s`;
  return `in ${formatDuration(Math.ceil(seconds / 60))}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.round(hours / 24)} days`;
}
