/**
 * Dates on the page, in the viewer's own locale and time zone, with the zone
 * shown so a saved result's time is never ambiguous.
 */
export function formatWhen(iso: string, style: "full" | "short" = "full"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "an unknown time";
  const options: Intl.DateTimeFormatOptions =
    style === "full"
      ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }
      : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

/** "0.8 s" or "120 ms". */
export function formatDuration(ms: number): string {
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}
