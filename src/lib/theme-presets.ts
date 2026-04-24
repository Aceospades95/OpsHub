export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  mode: "light" | "dark";
  colors: Record<string, string>;
  isCustom?: boolean;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "light-default",
    name: "Default Light",
    description: "Clean light theme with green accents",
    mode: "light",
    colors: {
      primary: "#15583e",
      "primary-foreground": "#ffffff",
      secondary: "#e4ede8",
      "secondary-foreground": "#15583e",
      accent: "#22885a",
      background: "#eef0f3",
      foreground: "#0a0a0a",
      muted: "#e8eaec",
      "muted-foreground": "#6b7c6b",
      border: "#d5d8dc",
      input: "#d5d8dc",
      card: "#ffffff",
      "card-foreground": "#0a0a0a",
      "card-border": "#c9ced4",
      destructive: "#ef4444",
      success: "#16a34a",
      warning: "#f59e0b",
    },
  },
  {
    id: "light-blue",
    name: "Ocean Light",
    description: "Cool blue tones",
    mode: "light",
    colors: {
      primary: "#1e40af",
      "primary-foreground": "#ffffff",
      secondary: "#dbeafe",
      "secondary-foreground": "#1e40af",
      accent: "#3b82f6",
      background: "#eff1f5",
      foreground: "#0f172a",
      muted: "#e2e8f0",
      "muted-foreground": "#64748b",
      border: "#cbd5e1",
      input: "#cbd5e1",
      card: "#ffffff",
      "card-foreground": "#0f172a",
      "card-border": "#bfc9d4",
      destructive: "#ef4444",
      success: "#16a34a",
      warning: "#f59e0b",
    },
  },
  {
    id: "light-purple",
    name: "Lavender",
    description: "Soft purple accents",
    mode: "light",
    colors: {
      primary: "#6d28d9",
      "primary-foreground": "#ffffff",
      secondary: "#ede9fe",
      "secondary-foreground": "#6d28d9",
      accent: "#8b5cf6",
      background: "#f0eff5",
      foreground: "#1e1b4b",
      muted: "#e8e5f0",
      "muted-foreground": "#7c7891",
      border: "#d4d0e0",
      input: "#d4d0e0",
      card: "#ffffff",
      "card-foreground": "#1e1b4b",
      "card-border": "#c8c3d6",
      destructive: "#ef4444",
      success: "#16a34a",
      warning: "#f59e0b",
    },
  },
  {
    id: "dark-default",
    name: "Default Dark",
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
      "card-border": "#4a6480",
      destructive: "#f87171",
      success: "#4ade80",
      warning: "#fbbf24",
    },
  },
  {
    id: "dark-midnight",
    name: "Midnight",
    description: "Deep dark with blue accents",
    mode: "dark",
    colors: {
      primary: "#3b82f6",
      "primary-foreground": "#ffffff",
      secondary: "#1e3a5f",
      "secondary-foreground": "#93c5fd",
      accent: "#60a5fa",
      background: "#0a0f1a",
      foreground: "#e2e8f0",
      muted: "#1a2332",
      "muted-foreground": "#8094ab",
      border: "#2d3f55",
      input: "#2d3f55",
      card: "#111827",
      "card-foreground": "#e2e8f0",
      "card-border": "#374b63",
      destructive: "#f87171",
      success: "#4ade80",
      warning: "#fbbf24",
    },
  },
  {
    id: "dark-charcoal",
    name: "Charcoal",
    description: "Warm neutral dark theme",
    mode: "dark",
    colors: {
      primary: "#f59e0b",
      "primary-foreground": "#1c1917",
      secondary: "#3d3530",
      "secondary-foreground": "#fde68a",
      accent: "#d97706",
      background: "#1c1917",
      foreground: "#f5f5f4",
      muted: "#2c2825",
      "muted-foreground": "#a8a29e",
      border: "#44403c",
      input: "#44403c",
      card: "#292524",
      "card-foreground": "#f5f5f4",
      "card-border": "#57534e",
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
