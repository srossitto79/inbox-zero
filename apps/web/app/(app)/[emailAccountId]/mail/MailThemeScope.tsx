"use client";

import { useEffect } from "react";
import { useUiVariant } from "@/providers/UiPreferencesProvider";

/**
 * Applies the Mail palette by stamping `data-theme="mail"` on the document root.
 *
 * It has to be the root rather than a wrapper element: Radix renders dropdowns,
 * dialogs and tooltips into a portal on <body>, so a wrapper-scoped theme would
 * leave every popover painted in the app's default palette on top of this screen.
 *
 * next-themes drives dark mode through a class, so an attribute doesn't collide.
 */
export function MailThemeScope() {
  const variant = useUiVariant();

  useEffect(() => {
    // The new interface's palettes own the look on every route.
    if (variant === "next") return;

    const { documentElement } = document;
    const previous = documentElement.dataset.theme;
    documentElement.dataset.theme = "mail";

    return () => {
      if (previous === undefined) delete documentElement.dataset.theme;
      else documentElement.dataset.theme = previous;
    };
  }, [variant]);

  return null;
}
