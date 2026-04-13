"use client";

/**
 * Textarea + @mention autocomplete.
 *
 * The user types `@foo` and we pop a floating list of matching employees.
 * Selecting one (click or Enter) replaces the trigger with a formatted
 * `@[Display Name](userId)` token in the underlying value — the display
 * layer converts that back to a link at render time.
 *
 * We intentionally keep the implementation self-contained rather than
 * depending on a rich-text library. The underlying value is plain text, so
 * existing places that just render `comment.content` keep working and the
 * tokenizer decides whether to show a link.
 *
 * Keyboard model:
 *   - ArrowUp / ArrowDown move selection within the dropdown
 *   - Enter / Tab accepts the highlighted suggestion
 *   - Escape closes the dropdown without inserting
 *   - Any other character / space / backspace that breaks the trigger
 *     closes the dropdown naturally
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { detectMentionTrigger, formatMentionToken } from "@/lib/mentions";
import { searchMentionableUsers } from "@/actions/comments";

interface MentionUser {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
}

interface MentionTextareaProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  minRows?: number;
}

export interface MentionTextareaHandle {
  focus: () => void;
  reset: () => void;
}

export const MentionTextarea = forwardRef<MentionTextareaHandle, MentionTextareaProps>(
  function MentionTextarea(
    { name, value, onChange, placeholder, required, disabled, className, minRows = 3 },
    ref
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [trigger, setTrigger] = useState<{ query: string; start: number } | null>(null);
    const [suggestions, setSuggestions] = useState<MentionUser[]>([]);
    const [highlight, setHighlight] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    // Track the active query so stale responses from a slower lookup
    // don't overwrite results from a newer one
    const activeQueryRef = useRef<string | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      reset: () => {
        setTrigger(null);
        setSuggestions([]);
        setHighlight(0);
      },
    }));

    // Fetch suggestions whenever the active trigger query changes
    useEffect(() => {
      if (trigger === null) {
        setSuggestions([]);
        setIsLoading(false);
        return;
      }
      const query = trigger.query;
      activeQueryRef.current = query;
      setIsLoading(true);
      searchMentionableUsers(query)
        .then((res) => {
          if (activeQueryRef.current !== query) return; // stale
          setSuggestions(res.users);
          setHighlight(0);
        })
        .catch(() => {
          if (activeQueryRef.current !== query) return;
          setSuggestions([]);
        })
        .finally(() => {
          if (activeQueryRef.current === query) setIsLoading(false);
        });
    }, [trigger]);

    const updateFromCursor = useCallback(
      (nextValue: string, cursor: number) => {
        const detected = detectMentionTrigger(nextValue, cursor);
        if (!detected) {
          setTrigger(null);
          return;
        }
        setTrigger({ query: detected.query, start: detected.queryStart });
      },
      []
    );

    const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      onChange(next);
      updateFromCursor(next, e.target.selectionStart);
    };

    const insertMention = useCallback(
      (user: MentionUser) => {
        if (!trigger || !textareaRef.current) return;
        const el = textareaRef.current;
        const cursor = el.selectionStart;
        // Replace from the `@` up to the current cursor with the token.
        const before = value.slice(0, trigger.start);
        const after = value.slice(cursor);
        const token = formatMentionToken(user.id, user.name);
        const next = `${before}${token} ${after}`;
        onChange(next);
        setTrigger(null);
        setSuggestions([]);

        // Restore cursor right after the inserted token (+1 for trailing space)
        const nextCursor = before.length + token.length + 1;
        // Have to wait for React to flush the new value before reselecting
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(nextCursor, nextCursor);
        });
      },
      [trigger, value, onChange]
    );

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!trigger || suggestions.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(suggestions[highlight]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setTrigger(null);
        setSuggestions([]);
      }
    };

    const showDropdown = trigger !== null && (isLoading || suggestions.length > 0);

    return (
      <div className="relative">
        {/* Hidden input carries the raw value in form submissions so callers
            that use plain <form action={...}> still see the mentions */}
        <input type="hidden" name={name} value={value} />

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Delay so the click handler on a suggestion fires first
            setTimeout(() => setTrigger(null), 120);
          }}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          rows={minRows}
          className={`flex min-h-[80px] w-full rounded border border-input bg-background px-3 py-2 text-sm
            placeholder:text-muted-foreground
            focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1
            disabled:cursor-not-allowed disabled:opacity-50 ${className || ""}`}
        />

        {showDropdown && (
          <div
            className="absolute left-0 right-0 top-full mt-1 z-20 max-h-64 overflow-y-auto rounded border border-border bg-popover shadow-md"
            // Prevent the textarea blur from firing before our click handler
            onMouseDown={(e) => e.preventDefault()}
          >
            {isLoading && suggestions.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                Searching employees…
              </div>
            )}
            {suggestions.map((u, idx) => (
              <button
                type="button"
                key={u.id}
                onClick={() => insertMention(u)}
                onMouseEnter={() => setHighlight(idx)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                  idx === highlight ? "bg-muted" : "hover:bg-muted/60"
                }`}
              >
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold uppercase text-primary">
                  {u.name
                    .split(" ")
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <span className="flex-1 truncate">
                  <span className="font-medium">{u.name}</span>
                  {u.jobTitle && (
                    <span className="text-muted-foreground"> — {u.jobTitle}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
);
