"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  CONTACT_ROLE_SUGGESTIONS,
  MAX_ROLE_TAGS_PER_LINK,
  MAX_ROLE_TAG_LENGTH,
} from "@/lib/contact-types";

/**
 * Multi-select role-tag editor for ContactLink.roles: the standard
 * vocabulary as toggle chips, plus a free-text "add your own tag"
 * input. Tags are free strings — suggestions are just quick-adds.
 * Dedupes case-insensitively and enforces the per-link caps client-
 * side (the server actions re-validate).
 */
export function RoleTagsInput({
  value,
  onChange,
  label = "Role tags",
  disabled = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState("");

  const lowerSet = new Set(value.map((t) => t.toLowerCase()));
  const atCap = value.length >= MAX_ROLE_TAGS_PER_LINK;

  function addTag(raw: string) {
    const tag = raw.trim().slice(0, MAX_ROLE_TAG_LENGTH);
    if (!tag || disabled) return;
    if (lowerSet.has(tag.toLowerCase()) || atCap) return;
    onChange([...value, tag]);
  }

  function removeTag(tag: string) {
    if (disabled) return;
    onChange(value.filter((t) => t !== tag));
  }

  function handleAddCustom() {
    addTag(custom);
    setCustom("");
  }

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-foreground">{label}</span>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                disabled={disabled}
                aria-label={`Remove tag ${tag}`}
                title={`Remove ${tag}`}
                className="rounded-full hover:text-destructive disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {CONTACT_ROLE_SUGGESTIONS.filter((s) => !lowerSet.has(s.toLowerCase())).map(
          (suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => addTag(suggestion)}
              disabled={disabled || atCap}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50 disabled:pointer-events-none"
            >
              <Plus className="h-3 w-3" />
              {suggestion}
            </button>
          )
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAddCustom();
            }
          }}
          maxLength={MAX_ROLE_TAG_LENGTH}
          disabled={disabled || atCap}
          placeholder={atCap ? `Max ${MAX_ROLE_TAGS_PER_LINK} tags` : "Add your own tag…"}
          aria-label="Add a custom role tag"
          className="h-8 w-full rounded border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleAddCustom}
          disabled={disabled || atCap || !custom.trim()}
          className="shrink-0 rounded border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50 disabled:pointer-events-none"
        >
          Add
        </button>
      </div>
    </div>
  );
}
