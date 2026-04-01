"use client";

import { useEffect } from "react";

interface ThemeProviderProps {
  themeSettings: Record<string, string>;
  children: React.ReactNode;
}

export function ThemeProvider({ themeSettings, children }: ThemeProviderProps) {
  useEffect(() => {
    const root = document.documentElement;
    const keys = Object.keys(themeSettings);
    for (const key of keys) {
      root.style.setProperty(`--${key}`, themeSettings[key]);
    }
    return () => {
      for (const key of keys) {
        root.style.removeProperty(`--${key}`);
      }
    };
  }, [themeSettings]);

  return <>{children}</>;
}
