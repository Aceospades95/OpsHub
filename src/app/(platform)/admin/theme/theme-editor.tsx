"use client";

import { useFormState } from "react-dom";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { saveThemeSettings, resetThemeToDefaults } from "@/actions/theme";
import { DEFAULT_THEME } from "@/lib/theme-defaults";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const THEME_GROUPS = [
  {
    title: "Brand Colors",
    description: "Primary colors that define your brand identity",
    keys: ["primary", "primary-foreground", "accent"],
  },
  {
    title: "Surface Colors",
    description: "Background, card, and border colors",
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
  destructive: "Destructive",
  success: "Success",
  warning: "Warning",
};

interface ThemeEditorProps {
  currentTheme: Record<string, string>;
}

export function ThemeEditor({ currentTheme }: ThemeEditorProps) {
  const [colors, setColors] = useState<Record<string, string>>(currentTheme);
  const [saveState, saveAction] = useFormState(saveThemeSettings, null);
  const [resetState, resetAction] = useFormState(resetThemeToDefaults, null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (saveState?.success) {
      router.refresh();
    }
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

  return (
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
  const style = Object.fromEntries(
    Object.entries(colors).map(([key, value]) => [`--${key}`, value])
  ) as React.CSSProperties;

  return (
    <div style={style} className="space-y-4 rounded-lg border p-4" data-preview>
      {/* Mini card */}
      <div
        className="rounded border p-4"
        style={{ background: colors.card, borderColor: colors.border, color: colors["card-foreground"] }}
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
      <div
        className="rounded p-3"
        style={{ background: colors.muted }}
      >
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
