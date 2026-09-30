export const UI_VARIANT_COOKIE = "ui-variant";
export const PALETTE_STORAGE_KEY = "ui-palette";

export type UiVariant = "next" | "classic";

export function parseUiVariant(value: string | undefined): UiVariant {
  return value === "classic" ? "classic" : "next";
}

export const PALETTES = [
  { id: "paper", label: "Paper", swatch: ["#F4F1EA", "#D9480F", "#1F1B16"] },
  { id: "sage", label: "Sage", swatch: ["#EFF2EC", "#2F7D5B", "#1F3A2D"] },
  { id: "ocean", label: "Ocean", swatch: ["#EEF3F8", "#1D6FD8", "#12314F"] },
  { id: "plum", label: "Plum", swatch: ["#F6F0F4", "#B4236C", "#4A1D3F"] },
  {
    id: "graphite",
    label: "Graphite",
    swatch: ["#F2F2F2", "#333333", "#171717"],
  },
  {
    id: "classic",
    label: "Classic",
    swatch: ["#FFFFFF", "#0F172A", "#94A3B8"],
  },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

export function getDefaultPalette(variant: UiVariant): PaletteId {
  return variant === "next" ? "paper" : "classic";
}

/** Runs before first paint so the palette never flashes. */
export function getPaletteScript(variant: UiVariant) {
  const fallback = getDefaultPalette(variant);
  return `(function(){var d=document.documentElement,p="${fallback}";try{p=localStorage.getItem("${PALETTE_STORAGE_KEY}")||p}catch(e){}if(p!=="classic")d.setAttribute("data-palette",p)})();`;
}
