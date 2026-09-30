"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import {
  getDefaultPalette,
  PALETTE_STORAGE_KEY,
  type PaletteId,
  UI_VARIANT_COOKIE,
  type UiVariant,
} from "@/utils/ui-variant";

type UiPreferences = {
  variant: UiVariant;
  palette: PaletteId;
  setPalette: (palette: PaletteId) => void;
  setVariant: (variant: UiVariant) => void;
};

const UiPreferencesContext = createContext<UiPreferences | null>(null);

export function UiPreferencesProvider({
  variant: initialVariant,
  children,
}: {
  variant: UiVariant;
  children: ReactNode;
}) {
  const [variant, setVariantState] = useState(initialVariant);
  const [palette, setPaletteState] = useState<PaletteId>(() =>
    readStoredPalette(initialVariant),
  );

  const setPalette = useCallback((next: PaletteId) => {
    setPaletteState(next);
    applyPalette(next);
    try {
      window.localStorage.setItem(PALETTE_STORAGE_KEY, next);
    } catch {
      // The palette still applies for this session.
    }
  }, []);

  const setVariant = useCallback((next: UiVariant) => {
    setVariantState(next);
    document.cookie = `${UI_VARIANT_COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax`;
    window.location.reload();
  }, []);

  return (
    <UiPreferencesContext.Provider
      value={{ variant, palette, setPalette, setVariant }}
    >
      {children}
    </UiPreferencesContext.Provider>
  );
}

export function useUiPreferences() {
  const context = useContext(UiPreferencesContext);
  if (!context) {
    throw new Error(
      "useUiPreferences must be used inside UiPreferencesProvider",
    );
  }
  return context;
}

/** Safe outside the provider, so shared components can branch on the shell. */
export function useUiVariant(): UiVariant {
  return useContext(UiPreferencesContext)?.variant ?? "classic";
}

function readStoredPalette(variant: UiVariant): PaletteId {
  if (typeof window === "undefined") return getDefaultPalette(variant);
  try {
    const stored = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    if (stored) return stored as PaletteId;
  } catch {
    // Fall through to the default.
  }
  return getDefaultPalette(variant);
}

function applyPalette(palette: PaletteId) {
  const root = document.documentElement;
  if (palette === "classic") delete root.dataset.palette;
  else root.dataset.palette = palette;
}
