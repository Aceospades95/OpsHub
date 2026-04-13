/**
 * @mention parsing + rendering helpers.
 *
 * Comments store mentions as `@[Display Name](userId)` — a stable format
 * inspired by markdown links. The userId survives rename, and the display
 * name is what the author saw at the time they typed it (so if someone
 * renames themselves the old mentions stay sensible).
 *
 * This module is intentionally framework-agnostic so it can run on both
 * the server (for notification wiring) and the client (for rendering
 * comments and driving the autocomplete).
 *
 * Format notes:
 *   - We use square brackets around the name so names with parens inside
 *     don't break the tokenizer
 *   - Display name may not contain `]` — the compose UI guarantees this by
 *     stripping disallowed characters before inserting
 *   - User id is restricted to the cuid shape Prisma emits (alphanumeric)
 */
import type { ReactNode } from "react";

/** Regex that matches a single `@[Name](id)` token. */
export const MENTION_TOKEN_REGEX = /@\[([^\]]+)\]\(([a-zA-Z0-9_-]+)\)/g;

/** Regex to detect the currently-typing trigger — `@foo` at end of a line */
export const MENTION_TRIGGER_REGEX = /(?:^|\s)@([\w.-]{0,40})$/;

export interface ParsedMention {
  /** Starting index in the raw string */
  start: number;
  /** Length of the raw token */
  length: number;
  /** Display name at time of authorship */
  name: string;
  /** User id target */
  userId: string;
}

/**
 * Find every @mention token in a string. Returns their positions so callers
 * can splice around them.
 */
export function parseMentions(text: string): ParsedMention[] {
  const out: ParsedMention[] = [];
  const re = new RegExp(MENTION_TOKEN_REGEX.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push({
      start: match.index,
      length: match[0].length,
      name: match[1],
      userId: match[2],
    });
  }
  return out;
}

/**
 * Unique user ids referenced by mentions in a piece of text. Duplicate
 * mentions of the same user collapse to one id so we don't double-notify.
 */
export function extractMentionedUserIds(text: string): string[] {
  return Array.from(new Set(parseMentions(text).map((m) => m.userId)));
}

/**
 * Strip mention formatting, leaving the plain display names. Used for
 * notification titles, email subjects, and anywhere a short plain-text
 * summary is needed.
 */
export function stripMentionFormatting(text: string): string {
  return text.replace(MENTION_TOKEN_REGEX, (_, name) => `@${name}`);
}

/**
 * Format a mention token for insertion into raw comment text.
 * Escapes the name so it can't itself contain `]` and break the tokenizer.
 */
export function formatMentionToken(userId: string, name: string): string {
  const safeName = name.replace(/[[\]]/g, "").trim();
  return `@[${safeName}](${userId})`;
}

/**
 * Split raw comment text into alternating plain-text and mention segments
 * for rendering. The caller decides how to render each — typically as
 * text nodes and Link components.
 *
 * Example:
 *   segmentMentions("Hey @[Alice](u1), see this")
 *   // → [
 *   //     { type: "text", value: "Hey " },
 *   //     { type: "mention", name: "Alice", userId: "u1" },
 *   //     { type: "text", value: ", see this" },
 *   //   ]
 */
export type MentionSegment =
  | { type: "text"; value: string }
  | { type: "mention"; name: string; userId: string };

export function segmentMentions(text: string): MentionSegment[] {
  const mentions = parseMentions(text);
  if (mentions.length === 0) return [{ type: "text", value: text }];

  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const m of mentions) {
    if (m.start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, m.start) });
    }
    segments.push({ type: "mention", name: m.name, userId: m.userId });
    cursor = m.start + m.length;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments;
}

/**
 * Helper used by the compose field: given the current textarea value and
 * cursor position, return the @-trigger state (or null if the user isn't
 * actively typing a mention). The returned `queryStart` is the index of
 * the `@` character so callers can splice the replacement in cleanly.
 */
export function detectMentionTrigger(
  value: string,
  cursor: number
): { query: string; queryStart: number } | null {
  const before = value.slice(0, cursor);
  const match = before.match(MENTION_TRIGGER_REGEX);
  if (!match) return null;
  const query = match[1];
  // queryStart = position of the @ character. The matched group starts at
  // before.length - (query.length) - 1 (the -1 is for the @).
  const queryStart = before.length - query.length - 1;
  return { query, queryStart };
}

/**
 * Render helper that lets React components reuse the segmentation without
 * reimplementing the tokenizer. Returns already-keyed React children.
 *
 * Keeping this in the pure module so its behavior is easy to unit-test
 * without mounting a component.
 */
export function renderMentions(
  text: string,
  renderMention: (m: { name: string; userId: string; key: string }) => ReactNode
): ReactNode[] {
  const segments = segmentMentions(text);
  return segments.map((seg, i) => {
    if (seg.type === "text") return seg.value;
    return renderMention({ name: seg.name, userId: seg.userId, key: `m-${i}` });
  });
}
