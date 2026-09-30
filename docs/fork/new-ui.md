# New UI

The fork replaces the presentation layer and keeps the engine (hooks, server
actions, API routes, mail engine, rules). The classic UI stays available through
Settings, Appearance, "Classic interface".

## Design language

- Palettes are runtime CSS variables in `apps/web/styles/palettes.css`, selected
  with `data-palette` on the document root. Use semantic tokens only:
  `bg-background`, `bg-card`, `bg-muted`, `text-foreground`,
  `text-muted-foreground`, `border-border`, `bg-primary`, `text-brand`,
  `bg-brand`. Never hard-code hex values or Tailwind gray/slate/zinc scales.
- Queue colors carry meaning: `queue-reply`, `queue-waiting`, `queue-fyi`,
  `queue-newsletter`, `queue-receipt`, `queue-calendar`.
- Page titles use `font-display` (Fraunces). Body text uses the body font.
- Cards are rounded (`rounded-2xl`), borders are light, surfaces are calm.
- Every automatic action should be explainable: say which rule acted and why.
- Mockups are in `docs/fork/design/*.dc.html` (open as plain HTML for the markup
  and spacing). They use sample data.
