"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
} from "@/components/ui/item";
import { useUiPreferences } from "@/providers/UiPreferencesProvider";
import { PALETTES } from "@/utils/ui-variant";
import { cn } from "@/utils";

export function AppearanceSection() {
  const { resolvedTheme, setTheme } = useTheme();
  const { variant, setVariant, palette, setPalette } = useUiPreferences();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDarkMode = mounted && resolvedTheme === "dark";

  return (
    <>
      <Item size="sm">
        <ItemContent>
          <ItemTitle>Dark mode</ItemTitle>
        </ItemContent>
        <ItemActions>
          <Switch
            aria-label="Toggle dark mode"
            checked={isDarkMode}
            onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
            disabled={!mounted}
          />
        </ItemActions>
      </Item>
      <Item size="sm">
        <ItemContent>
          <ItemTitle>Palette</ItemTitle>
        </ItemContent>
        <ItemActions>
          <div className="flex flex-wrap justify-end gap-2">
            {PALETTES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={mounted && palette === option.id}
                onClick={() => setPalette(option.id)}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs",
                  mounted && palette === option.id
                    ? "border-foreground bg-accent font-medium"
                    : "border-border hover:bg-accent",
                )}
              >
                <span className="flex -space-x-1">
                  {option.swatch.map((color) => (
                    <span
                      key={color}
                      className="size-3.5 rounded-full border border-black/10"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </span>
                {option.label}
              </button>
            ))}
          </div>
        </ItemActions>
      </Item>
      <Item size="sm">
        <ItemContent>
          <ItemTitle>Classic interface</ItemTitle>
        </ItemContent>
        <ItemActions>
          <Switch
            aria-label="Use the classic interface"
            checked={variant === "classic"}
            onCheckedChange={(checked) =>
              setVariant(checked ? "classic" : "next")
            }
          />
        </ItemActions>
      </Item>
    </>
  );
}
