"use client";

import { useFormState } from "react-dom";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { saveThemeSettings, resetThemeToDefaults } from "@/actions/theme";
import { DEFAULT_THEME } from "@/lib/theme-defaults";
import { THEME_PRESETS, getLightPresets, getDarkPresets, type ThemePreset } from "@/lib/theme-presets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sun, Moon, Check, Palette } from "lucide-react";

const THEME_GROUPS = [
  {
    title: "Brand Colors",
    description: "Primary colors that define your brand identity",
    keys: ["primary", "primary-foreground", "accent"],
  },
  {
    title: "Surface Colors",
    description: "Background, card, and border colors. Card Border controls how prominently cards stand out from the page background.",
    keys: [
      "background",
      "foreground",
      "secondary",
      "secondary-foreground",
      "muted",
      "muted-foreground",
      "border",
      "input",
      "card",
      "card-foreground",
      "card-border",
    ],
  },
  {
    title: "Status Colors",
    description: "Colors used for status indicators and alerts",
    keys: ["destructive", "success", "warning"],
  },
] as const;

const LABELS: Record<string, string> = {
  primary: "Primary",
  "primary-foreground": "Primary Text",
  accent: "Accent",
  background: "Background",
  foreground: "Foreground",
  secondary: "Secondary",
  "secondary-foreground": "Secondary Text",
  muted: "Muted",
  "muted-foreground": "Muted Text",
  border: "Border",
  input: "Input Border",
  card: "Card",
  "card-foreground": "Card Text",
  "card-border": "Card Border",
  destructive: "Destructive",
  success: "Success",
  warning: "Warning",
};

interface ThemeEditorProps {
  currentTheme: Record<string, string>;
}

export function ThemeEditor({ currentTheme }: ThemeEditorProps) {
  const [colors, setColors] = useState<Record<string, string>>(currentTheme);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(true);
  const [saveState, saveAction] = useFormState(saveThemeSettings, null);
  const [resetState, resetAction] = useFormState(resetThemeToDefaults, null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  // Detect which preset matches current colors
  useEffect(() => {
    const match = THEME_PRESETS.find((p) =>
      Object.entries(p.colors).every(([k, v]) => colors[k]?.toLowerCase() === v.toLowerCase())
    );
    setActivePreset(match?.id || null);
  }, [colors]);

  useEffect(() => {
    if (saveState?.success) router.refresh();
  }, [saveState, router]);

  useEffect(() => {
    if (resetState?.success) {
      setColors({ ...DEFAULT_THEME });
      router.refresh();
    }
  }, [resetState, router]);

  function handleColorChange(key: string, value: string) {
    setColors((prev) => ({ ...prev, [key]: value }));
  }

  function applyPreset(preset: ThemePreset) {
    setColors({ ...preset.colors });
  }

  const lightPresets = getLightPresets();
  const darkPresets = getDarkPresets();

  return (
    <div className="space-y-6">
      {/* Preset Themes Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" /> Theme Presets
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowPresets(!showPresets)}>
              {showPresets ? "Hide" : "Show"}
            </Button>
          </div>
        </CardHeader>
        {showPresets && (
          <CardContent className="space-y-6">
            {/* Light themes */}
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Sun className="h-4 w-4 text-yellow-500" /> Light Themes
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {lightPresets.map((preset) => (
                  <PresetCard
                    key={preset.id}
                    preset={preset}
                    isActive={activePreset === preset.id}
                    onClick={() => applyPreset(preset)}
                  />
                ))}
              </div>
            </div>

            {/* Dark themes */}
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Moon className="h-4 w-4 text-blue-400" /> Dark Themes
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {darkPresets.map((preset) => (
                  <PresetCard
                    key={preset.id}
                    preset={preset}
                    isActive={activePreset === preset.id}
                    onClick={() => applyPreset(preset)}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Color editor + preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <form ref={formRef} action={saveAction}>
            {Object.keys(DEFAULT_THEME).map((key) => (
              <input key={key} type="hidden" name={key} value={colors[key] || DEFAULT_THEME[key]} />
            ))}

            {THEME_GROUPS.map((group) => (
              <Card key={group.title} className="mb-6">
                <CardHeader>
                  <CardTitle>{group.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">{group.description}</p>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {group.keys.map((key) => (
                      <ColorInput
                        key={key}
                        label={LABELS[key] || key}
                        value={colors[key] || DEFAULT_THEME[key]}
                        onChange={(v) => handleColorChange(key, v)}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}

            {saveState?.error && (
              <div className="rounded bg-destructive/10 p-3 text-sm text-destructive mb-4">
                {saveState.error}
              </div>
            )}
            {saveState?.success && (
              <div className="rounded bg-success/10 p-3 text-sm text-success mb-4">
                Theme saved successfully.
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit">Save Theme</Button>
              <Button type="button" variant="outline" formAction={resetAction}>
                Reset to Defaults
              </Button>
            </div>
          </form>
        </div>

        {/* Live Preview Panel */}
        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <Card>
              <CardHeader>
                <CardTitle>Live Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <PreviewPanel colors={colors} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function PresetCard({
  preset,
  isActive,
  onClick,
}: {
  preset: ThemePreset;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative rounded-lg border-2 p-3 text-left transition-all hover:shadow-md ${
        isActive
          ? "border-primary ring-2 ring-primary/20"
          : "border-border hover:border-primary/40"
      }`}
      style={{ background: preset.colors.background }}
    >
      {isActive && (
        <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full flex items-center justify-center"
          style={{ background: preset.colors.primary }}>
          <Check className="h-3 w-3" style={{ color: preset.colors["primary-foreground"] }} />
        </div>
      )}

      {/* Color swatches */}
      <div className="flex gap-1 mb-2">
        <div className="h-6 w-6 rounded-full border border-white/20" style={{ background: preset.colors.primary }} />
        <div className="h-6 w-6 rounded-full border border-white/20" style={{ background: preset.colors.accent }} />
        <div className="h-6 w-6 rounded-full border border-white/20" style={{ background: preset.colors.secondary }} />
        <div className="h-6 w-6 rounded-full border border-white/20" style={{ background: preset.colors.muted }} />
      </div>

      {/* Mini preview */}
      <div className="rounded p-2 mb-2" style={{ background: preset.colors.card, border: `1px solid ${preset.colors.border}` }}>
        <div className="h-1.5 w-3/4 rounded-full mb-1" style={{ background: preset.colors.foreground, opacity: 0.7 }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: preset.colors["muted-foreground"], opacity: 0.5 }} />
      </div>

      {/* Name */}
      <p className="text-xs font-semibold truncate" style={{ color: preset.colors.foreground }}>{preset.name}</p>
      <p className="text-[10px] truncate" style={{ color: preset.colors["muted-foreground"] }}>{preset.description}</p>
    </button>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-10 cursor-pointer rounded border border-input p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) {
              onChange(v);
            }
          }}
          className="flex h-10 flex-1 rounded border border-input bg-background px-3 py-2 text-sm font-mono
            placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
          placeholder="#000000"
          maxLength={7}
        />
      </div>
    </div>
  );
}

function PreviewPanel({ colors }: { colors: Record<string, string> }) {
  return (
    <div
      className="space-y-4 rounded-lg border p-4"
      style={{
        background: colors.background,
        borderColor: colors.border,
        color: colors.foreground,
      }}
    >
      {/* Sidebar preview */}
      <div className="flex gap-2">
        <div className="w-12 rounded-md p-1.5 space-y-1" style={{ background: colors.card, border: `1px solid ${colors.border}` }}>
          {[colors.primary, colors.accent, colors["muted-foreground"], colors["muted-foreground"]].map((c, i) => (
            <div key={i} className="h-1.5 rounded-full" style={{ background: c, opacity: i > 1 ? 0.4 : 1 }} />
          ))}
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-2/3 rounded" style={{ background: colors.foreground, opacity: 0.8 }} />
          <div className="h-2 w-full rounded" style={{ background: colors["muted-foreground"], opacity: 0.3 }} />
          <div className="h-2 w-4/5 rounded" style={{ background: colors["muted-foreground"], opacity: 0.3 }} />
        </div>
      </div>

      {/* Mini card */}
      <div
        className="rounded border p-4"
        style={{
          background: colors.card,
          borderColor: colors["card-border"] || colors.border,
          color: colors["card-foreground"],
          boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 4px 12px -2px rgb(0 0 0 / 0.08)",
        }}
      >
        <p className="text-sm font-semibold mb-1">Sample Card</p>
        <p className="text-xs" style={{ color: colors["muted-foreground"] }}>
          This is how a card looks with the selected theme.
        </p>
      </div>

      {/* Buttons row */}
      <div className="flex flex-wrap gap-2">
        <span
          className="inline-flex items-center justify-center rounded px-3 py-1.5 text-xs font-medium"
          style={{ background: colors.primary, color: colors["primary-foreground"] }}
        >
          Primary
        </span>
        <span
          className="inline-flex items-center justify-center rounded px-3 py-1.5 text-xs font-medium"
          style={{ background: colors.secondary, color: colors["secondary-foreground"] }}
        >
          Secondary
        </span>
        <span
          className="inline-flex items-center justify-center rounded px-3 py-1.5 text-xs font-medium"
          style={{ background: colors.accent, color: "#ffffff" }}
        >
          Accent
        </span>
      </div>

      {/* Status indicators */}
      <div className="flex gap-3">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors.success }} />
          <span className="text-xs" style={{ color: colors.foreground }}>Success</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors.warning }} />
          <span className="text-xs" style={{ color: colors.foreground }}>Warning</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors.destructive }} />
          <span className="text-xs" style={{ color: colors.foreground }}>Error</span>
        </div>
      </div>

      {/* Muted section */}
      <div className="rounded p-3" style={{ background: colors.muted }}>
        <p className="text-xs" style={{ color: colors["muted-foreground"] }}>
          Muted background area for secondary content.
        </p>
      </div>

      {/* Input preview */}
      <div
        className="flex h-8 items-center rounded border px-3 text-xs"
        style={{
          background: colors.background,
          borderColor: colors.input,
          color: colors["muted-foreground"],
        }}
      >
        Input placeholder text...
      </div>
    </div>
  );
}
