"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  GripVertical,
  RotateCcw,
  ArrowRightToLine,
} from "lucide-react";
import { saveSidebarConfig, resetSidebarConfig } from "@/actions/sidebar";
import { SYSTEM_MODULES, type SidebarConfig, type SidebarSectionConfig, type SidebarItemConfig } from "@/lib/sidebar-config";

interface Props {
  initialConfig: SidebarConfig;
  customPages: { id: string; title: string }[];
}

export function SidebarEditor({ initialConfig, customPages }: Props) {
  const [config, setConfig] = useState<SidebarConfig>(initialConfig);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const router = useRouter();

  // Get all item keys currently in config
  const usedKeys = new Set(
    config.sections.flatMap((s) => s.items.map((i) => i.key))
  );

  // Available custom pages not yet added
  const availableCustomPages = customPages.filter(
    (p) => !usedKeys.has(`custom-${p.id}`)
  );

  // Available system modules not yet added
  const availableSystemModules = Object.keys(SYSTEM_MODULES).filter(
    (key) => !usedKeys.has(key)
  );

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const result = await saveSidebarConfig(config);
    if (result.success) {
      setMessage({ type: "success", text: "Sidebar layout saved" });
      router.refresh();
    } else {
      setMessage({ type: "error", text: result.error || "Failed to save" });
    }
    setSaving(false);
  }

  async function handleReset() {
    setSaving(true);
    setMessage(null);
    const result = await resetSidebarConfig();
    if (result.success) {
      setMessage({ type: "success", text: "Sidebar reset to defaults" });
      router.refresh();
      // Reload config from server
      window.location.reload();
    } else {
      // Surface the failure — the button previously just stopped
      // spinning with no feedback.
      setMessage({ type: "error", text: result.error || "Failed to reset" });
    }
    setSaving(false);
  }

  function updateSection(sectionIndex: number, updates: Partial<SidebarSectionConfig>) {
    setConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s, i) => (i === sectionIndex ? { ...s, ...updates } : s)),
    }));
  }

  function moveSection(index: number, direction: -1 | 1) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= config.sections.length) return;
    setConfig((prev) => {
      const sections = [...prev.sections];
      [sections[index], sections[newIndex]] = [sections[newIndex], sections[index]];
      return { ...prev, sections };
    });
  }

  function removeSection(index: number) {
    setConfig((prev) => ({
      ...prev,
      sections: prev.sections.filter((_, i) => i !== index),
    }));
  }

  function addSection() {
    if (!newSectionTitle.trim()) return;
    setConfig((prev) => ({
      ...prev,
      sections: [
        ...prev.sections,
        {
          id: `section-${Date.now()}`,
          title: newSectionTitle.trim(),
          items: [],
        },
      ],
    }));
    setNewSectionTitle("");
  }

  function moveItem(sectionIndex: number, itemIndex: number, direction: -1 | 1) {
    const newItemIndex = itemIndex + direction;
    const section = config.sections[sectionIndex];
    if (newItemIndex < 0 || newItemIndex >= section.items.length) return;
    setConfig((prev) => {
      const sections = [...prev.sections];
      const items = [...sections[sectionIndex].items];
      [items[itemIndex], items[newItemIndex]] = [items[newItemIndex], items[itemIndex]];
      sections[sectionIndex] = { ...sections[sectionIndex], items };
      return { ...prev, sections };
    });
  }

  function toggleItemVisibility(sectionIndex: number, itemIndex: number) {
    setConfig((prev) => {
      const sections = [...prev.sections];
      const items = [...sections[sectionIndex].items];
      items[itemIndex] = { ...items[itemIndex], visible: !items[itemIndex].visible };
      sections[sectionIndex] = { ...sections[sectionIndex], items };
      return { ...prev, sections };
    });
  }

  function removeItem(sectionIndex: number, itemIndex: number) {
    setConfig((prev) => {
      const sections = [...prev.sections];
      const items = sections[sectionIndex].items.filter((_, i) => i !== itemIndex);
      sections[sectionIndex] = { ...sections[sectionIndex], items };
      return { ...prev, sections };
    });
  }

  function moveItemToSection(fromSection: number, itemIndex: number, toSection: number) {
    setConfig((prev) => {
      const sections = [...prev.sections];
      const item = sections[fromSection].items[itemIndex];
      sections[fromSection] = {
        ...sections[fromSection],
        items: sections[fromSection].items.filter((_, i) => i !== itemIndex),
      };
      sections[toSection] = {
        ...sections[toSection],
        items: [...sections[toSection].items, item],
      };
      return { ...prev, sections };
    });
  }

  function addItemToSection(sectionIndex: number, key: string) {
    const label = key.startsWith("custom-")
      ? customPages.find((p) => `custom-${p.id}` === key)?.title
      : SYSTEM_MODULES[key]?.label;

    setConfig((prev) => {
      const sections = [...prev.sections];
      sections[sectionIndex] = {
        ...sections[sectionIndex],
        items: [...sections[sectionIndex].items, { key, label, visible: true }],
      };
      return { ...prev, sections };
    });
  }

  function getItemLabel(item: SidebarItemConfig): string {
    if (item.label) return item.label;
    if (item.key.startsWith("custom-")) {
      const page = customPages.find((p) => `custom-${p.id}` === item.key);
      return page?.title || item.key;
    }
    return SYSTEM_MODULES[item.key]?.label || item.key;
  }

  return (
    <div className="space-y-6">
      {/* Sections */}
      {config.sections.map((section, sectionIndex) => (
        <Card key={section.id}>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <GripVertical className="h-6 w-6 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={section.title}
                onChange={(e) => updateSection(sectionIndex, { title: e.target.value })}
                placeholder="Section title (leave empty for no header)"
                className="flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-muted-foreground min-w-0"
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => moveSection(sectionIndex, -1)}
                disabled={sectionIndex === 0}
                className="h-10 w-10 p-0"
                aria-label={`Move section "${section.title || `Section ${sectionIndex + 1}`}" up`}
                title="Move section up"
              >
                <ChevronUp className="h-6 w-6" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => moveSection(sectionIndex, 1)}
                disabled={sectionIndex === config.sections.length - 1}
                className="h-10 w-10 p-0"
                aria-label={`Move section "${section.title || `Section ${sectionIndex + 1}`}" down`}
                title="Move section down"
              >
                <ChevronDown className="h-6 w-6" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeSection(sectionIndex)}
                className="h-10 w-10 p-0 text-destructive hover:text-destructive"
                aria-label={`Delete section "${section.title || `Section ${sectionIndex + 1}`}"`}
                title="Delete section"
              >
                <Trash2 className="h-6 w-6" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {section.items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No items in this section. Add modules below.</p>
            ) : (
              <div className="space-y-1">
                {section.items.map((item, itemIndex) => (
                  <div
                    key={item.key}
                    className={`flex items-center gap-3 rounded border border-border px-3 py-2 ${
                      item.visible ? "bg-card" : "bg-muted opacity-60"
                    }`}
                  >
                    <GripVertical className="h-6 w-6 text-muted-foreground shrink-0" />
                    <span
                      className={`flex-1 min-w-0 truncate text-sm ${item.visible ? "font-medium" : "line-through text-muted-foreground"}`}
                      title={getItemLabel(item)}
                    >
                      {getItemLabel(item)}
                    </span>
                    {item.key.startsWith("custom-") && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">page</span>
                    )}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 p-0"
                        onClick={() => moveItem(sectionIndex, itemIndex, -1)}
                        disabled={itemIndex === 0}
                        aria-label={`Move "${getItemLabel(item)}" up`}
                        title="Move item up"
                      >
                        <ChevronUp className="h-6 w-6" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 p-0"
                        onClick={() => moveItem(sectionIndex, itemIndex, 1)}
                        disabled={itemIndex === section.items.length - 1}
                        aria-label={`Move "${getItemLabel(item)}" down`}
                        title="Move item down"
                      >
                        <ChevronDown className="h-6 w-6" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 p-0"
                        onClick={() => toggleItemVisibility(sectionIndex, itemIndex)}
                        aria-label={item.visible ? `Hide "${getItemLabel(item)}" from sidebar` : `Show "${getItemLabel(item)}" in sidebar`}
                        title={item.visible ? "Hide from sidebar" : "Show in sidebar"}
                      >
                        {item.visible ? <Eye className="h-6 w-6" /> : <EyeOff className="h-6 w-6" />}
                      </Button>
                      {/* Move to another section */}
                      {config.sections.length > 1 && (
                        <div className="relative">
                          <select
                            value=""
                            onChange={(e) => {
                              const toIdx = parseInt(e.target.value);
                              if (!isNaN(toIdx)) moveItemToSection(sectionIndex, itemIndex, toIdx);
                            }}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            aria-label={`Move "${getItemLabel(item)}" to another section`}
                            title="Move to another section"
                          >
                            <option value="">Move to...</option>
                            {config.sections.map((s, i) => i !== sectionIndex && (
                              <option key={s.id} value={i}>{s.title || `Section ${i + 1}`}</option>
                            ))}
                          </select>
                          <div className="h-10 w-10 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground pointer-events-none" aria-hidden>
                            <ArrowRightToLine className="h-6 w-6" />
                          </div>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 p-0 text-destructive"
                        onClick={() => removeItem(sectionIndex, itemIndex)}
                        aria-label={`Remove "${getItemLabel(item)}" from sidebar`}
                        title="Remove from sidebar"
                      >
                        <Trash2 className="h-6 w-6" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add item to this section */}
            {(availableSystemModules.length > 0 || availableCustomPages.length > 0) && (
              <div className="mt-3 pt-3 border-t border-border">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) addItemToSection(sectionIndex, e.target.value);
                  }}
                  className="h-8 rounded border border-input bg-background px-2 text-xs text-muted-foreground w-full max-w-xs"
                >
                  <option value="">+ Add module to this section...</option>
                  {availableSystemModules.length > 0 && (
                    <optgroup label="System Modules">
                      {availableSystemModules.map((key) => (
                        <option key={key} value={key}>{SYSTEM_MODULES[key].label}</option>
                      ))}
                    </optgroup>
                  )}
                  {availableCustomPages.length > 0 && (
                    <optgroup label="Custom Pages">
                      {availableCustomPages.map((page) => (
                        <option key={page.id} value={`custom-${page.id}`}>{page.title}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Add new section */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Input
              value={newSectionTitle}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewSectionTitle(e.target.value)}
              placeholder="New section name (e.g., Employee Resources)"
              className="flex-1"
              onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && addSection()}
            />
            <Button onClick={addSection} disabled={!newSectionTitle.trim()} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add Section
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Save / Reset */}
      {message && (
        <div className={`rounded p-3 text-sm ${message.type === "success" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
          {message.text}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Layout"}
        </Button>
        <Button variant="outline" onClick={handleReset} disabled={saving}>
          <RotateCcw className="h-4 w-4 mr-1" /> Reset to Defaults
        </Button>
      </div>
    </div>
  );
}
