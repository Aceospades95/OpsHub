"use client";

import { useEffect } from "react";

interface ThemeProviderProps {
  themeSettings: Record<string, string>;
  children: React.ReactNode;
}

const HEX_RE = /^#([0-9a-f]{6})$/i;

/**
 * "#15583e" → "21 88 62". Returns null for anything that isn't a
 * 6-digit hex color (branding keys, radius, malformed rows) so we
 * never emit a bogus -rgb var.
 */
function hexToRgbTriplet(value: string): string | null {
  const match = HEX_RE.exec(value.trim());
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

export function ThemeProvider({ themeSettings, children }: ThemeProviderProps) {
  useEffect(() => {
    const root = document.documentElement;
    const keys = Object.keys(themeSettings);
    for (const key of keys) {
      root.style.setProperty(`--${key}`, themeSettings[key]);
      // Keep the RGB-triplet twin in sync — Tailwind utilities read
      // --{key}-rgb (see globals.css / tailwind.config.ts) so alpha
      // modifiers like bg-primary/10 track the admin-applied theme.
      const triplet = hexToRgbTriplet(themeSettings[key]);
      if (triplet) root.style.setProperty(`--${key}-rgb`, triplet);
    }
    return () => {
      for (const key of keys) {
        root.style.removeProperty(`--${key}`);
        root.style.removeProperty(`--${key}-rgb`);
      }
    };
  }, [themeSettings]);

  return <>{children}</>;
}
