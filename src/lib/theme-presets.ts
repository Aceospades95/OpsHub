export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  mode: "light" | "dark";
  colors: Record<string, string>;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "light",
    name: "Light",
    description: "Clean light theme",
    mode: "light",
    colors: {
      primary: "#15583e",
      "primary-foreground": "#ffffff",
      secondary: "#e4ede8",
      "secondary-foreground": "#15583e",
      accent: "#22885a",
      background: "#f3f4f6",
      foreground: "#0a0a0a",
      muted: "#e8eaec",
      "muted-foreground": "#6b7c6b",
      border: "#d5d8dc",
      input: "#d5d8dc",
      card: "#ffffff",
      "card-foreground": "#0a0a0a",
      destructive: "#ef4444",
      success: "#16a34a",
      warning: "#f59e0b",
    },
  },
  {
    id: "dark",
    name: "Dark",
    description: "Easy-on-the-eyes dark theme",
    mode: "dark",
    colors: {
      primary: "#22c55e",
      "primary-foreground": "#052e16",
      secondary: "#2d4058",
      "secondary-foreground": "#e2e8f0",
      accent: "#34d399",
      background: "#111927",
      foreground: "#f1f5f9",
      muted: "#253548",
      "muted-foreground": "#94a3b8",
      border: "#3d5570",
      input: "#3d5570",
      card: "#1a2a40",
      "card-foreground": "#f1f5f9",
      destructive: "#f87171",
      success: "#4ade80",
      warning: "#fbbf24",
    },
  },
];

export function getPresetById(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}

export function getLightPresets(): ThemePreset[] {
  return THEME_PRESETS.filter((p) => p.mode === "light");
}

export function getDarkPresets(): ThemePreset[] {
  return THEME_PRESETS.filter((p) => p.mode === "dark");
}
