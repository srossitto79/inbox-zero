// CSS variables so charts follow the active palette and dark mode.
export const CHART_COLORS = {
  primary: "hsl(var(--brand))",
  secondary: "hsl(var(--queue-newsletter))",
  accent: "hsl(var(--queue-calendar))",
  accentMuted: "hsl(var(--queue-calendar) / 0.4)",
  positive: "hsl(var(--queue-receipt))",
  positiveMuted: "hsl(var(--queue-receipt) / 0.4)",
} as const;

export const RULE_CHART_COLORS = [
  "hsl(var(--brand))",
  "hsl(var(--queue-newsletter))",
  "hsl(var(--queue-waiting))",
  "hsl(var(--queue-receipt))",
  "hsl(var(--queue-calendar))",
  "hsl(var(--queue-fyi))",
];
