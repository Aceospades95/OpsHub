"use client";

import { useEffect, useRef } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Pilcrow,
  Heading2,
  Palette,
  Variable,
} from "lucide-react";

/**
 * Rich-text editor with bold / italic / lists / headings / color +
 * a variable-chip extension that round-trips `{{path}}` tokens.
 *
 * The author types in plain English, picks formatting from the
 * toolbar, and inserts variables from a click-to-insert popover.
 * The editor stores ProseMirror state internally; on every change we
 * call `onChange(html)` with the serialized HTML — and that HTML
 * uses `{{path.to.value}}` tokens for variables so the workflow
 * engine's `substituteVariables()` resolver picks them up unchanged
 * at send time.
 *
 * Custom mention serialization: by default TipTap's Mention
 * extension renders to a `<span data-type="mention">` element. We
 * override `renderHTML` so the document's HTML output uses the
 * literal `{{path}}` text instead — that's the contract with the
 * email-rendering layer in src/lib/workflows/handlers/send-email.ts.
 */

export interface VariableOption {
  /** Dot-path resolved at send time (e.g. "subject.firstName"). */
  path: string;
  description: string;
}

interface Props {
  /** HTML body. May contain `{{path}}` literals — they're round-tripped
   *  back into Mention chips when the editor mounts. */
  value: string;
  onChange: (html: string) => void;
  variables?: VariableOption[];
  placeholder?: string;
  className?: string;
}

export function RichTextEditor({
  value,
  onChange,
  variables = [],
  placeholder,
  className = "",
}: Props) {
  // Track the latest value passed in so we can sync external changes
  // (e.g. when the variable popover inserts via editor commands and
  // the parent updates `value`). We avoid re-setting content on every
  // onChange to prevent cursor jumps.
  const lastSetValue = useRef(value);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // The default StarterKit ships heading at all 6 levels — we only
        // want H2 + paragraph for emails. Keep it lean.
        heading: { levels: [2] },
      }),
      TextStyle,
      Color,
      Placeholder.configure({
        placeholder: placeholder ?? "Hi {{subject.firstName}}, …",
        emptyEditorClass:
          "before:content-[attr(data-placeholder)] before:float-left before:text-neutral-400 before:pointer-events-none",
      }),
      Mention.configure({
        HTMLAttributes: {
          class:
            "inline-block rounded bg-primary/10 text-primary px-1.5 py-0.5 text-xs font-mono no-underline",
        },
        // The default Mention extension stores `{ id, label }` on the
        // node. We use `id` for the dot-path (subject.firstName) and
        // `label` for the human-readable description. On HTML
        // serialization we emit the literal `{{id}}` token so
        // downstream rendering uses the workflow engine's variable
        // resolver. On parse-back-in we re-recognize the same token.
        renderHTML({ node }) {
          const path = (node.attrs.id as string) ?? "";
          // Returning a string here makes Tiptap emit literal text in
          // the serialized HTML instead of an element. That's exactly
          // what substituteVariables() expects to see.
          return [
            "span",
            {
              "data-mention": path,
              class:
                "inline-block rounded bg-primary/10 text-primary px-1.5 py-0.5 text-xs font-mono",
            },
            `{{${path}}}`,
          ];
        },
        renderText({ node }) {
          // Plain-text serialization (used when copying or for the
          // text body fallback) — same `{{path}}` shape.
          return `{{${node.attrs.id}}}`;
        },
      }),
    ],
    // Convert {{path}} literals in the seed HTML into mention nodes
    // BEFORE handing to the editor so they render as chips, not text.
    content: hydrateMentions(value, variables),
    onUpdate({ editor }) {
      const html = editor.getHTML();
      lastSetValue.current = html;
      onChange(html);
    },
    immediatelyRender: false,
  });

  // External value sync — only re-set content if the parent's value
  // diverged from what we last emitted. This handles `Reset` / programmatic
  // template loads without trampling user typing.
  useEffect(() => {
    if (!editor) return;
    if (value !== lastSetValue.current) {
      lastSetValue.current = value;
      editor.commands.setContent(hydrateMentions(value, variables), {
        emitUpdate: false,
      });
    }
  }, [value, editor, variables]);

  if (!editor) {
    // SSR / first-paint placeholder — same shape as the mounted editor
    // so layout doesn't shift.
    return (
      <div className={`rounded border border-input bg-background ${className}`}>
        <div className="border-b border-input p-2 h-9" />
        <div className="p-3 min-h-[160px] text-sm text-muted-foreground">
          Loading editor…
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded border border-input bg-background ${className}`}>
      <Toolbar editor={editor} variables={variables} />
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none p-3 min-h-[160px] focus:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[140px]"
      />
    </div>
  );
}

// ─── Toolbar ────────────────────────────────────────────────────────────

const PALETTE: { label: string; value: string }[] = [
  { label: "Default", value: "" },
  { label: "Black", value: "#1a1a1a" },
  { label: "Gray", value: "#6b7280" },
  { label: "Red", value: "#dc2626" },
  { label: "Blue", value: "#2563eb" },
  { label: "Green", value: "#16a34a" },
  { label: "Amber", value: "#d97706" },
];

function Toolbar({
  editor,
  variables,
}: {
  editor: Editor;
  variables: VariableOption[];
}) {
  return (
    <div className="flex items-center gap-1 border-b border-input p-1.5 flex-wrap">
      <ToolBtn
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        ariaLabel="Bold"
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        ariaLabel="Italic"
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolBtn>
      <Divider />
      <ToolBtn
        active={editor.isActive("paragraph")}
        onClick={() => editor.chain().focus().setParagraph().run()}
        ariaLabel="Paragraph"
      >
        <Pilcrow className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn
        active={editor.isActive("heading", { level: 2 })}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
        ariaLabel="Heading"
      >
        <Heading2 className="h-3.5 w-3.5" />
      </ToolBtn>
      <Divider />
      <ToolBtn
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        ariaLabel="Bulleted list"
      >
        <List className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        ariaLabel="Numbered list"
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolBtn>
      <Divider />
      <ColorPicker editor={editor} />
      {variables.length > 0 && (
        <>
          <Divider />
          <VariableMenu editor={editor} variables={variables} />
        </>
      )}
    </div>
  );
}

function ToolBtn({
  active,
  onClick,
  children,
  ariaLabel,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`p-1.5 rounded text-foreground hover:bg-muted transition-colors ${
        active ? "bg-muted" : ""
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-border mx-0.5" />;
}

function ColorPicker({ editor }: { editor: Editor }) {
  return (
    <div className="relative group">
      <button
        type="button"
        aria-label="Text color"
        className="p-1.5 rounded text-foreground hover:bg-muted transition-colors"
      >
        <Palette className="h-3.5 w-3.5" />
      </button>
      <div className="absolute top-full left-0 mt-1 hidden group-hover:flex group-focus-within:flex flex-wrap gap-1 p-2 rounded border border-border bg-card shadow-lg z-10 w-44">
        {PALETTE.map((c) => (
          <button
            key={c.value || "default"}
            type="button"
            onClick={() => {
              if (c.value) {
                editor.chain().focus().setColor(c.value).run();
              } else {
                editor.chain().focus().unsetColor().run();
              }
            }}
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-muted w-full text-left"
          >
            <span
              className="inline-block w-3 h-3 rounded border border-border"
              style={{ background: c.value || "transparent" }}
            />
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function VariableMenu({
  editor,
  variables,
}: {
  editor: Editor;
  variables: VariableOption[];
}) {
  function insertVariable(path: string, label: string) {
    editor
      .chain()
      .focus()
      .insertContent({
        type: "mention",
        attrs: { id: path, label },
      })
      // Drop a space after so the cursor lands cleanly outside the chip.
      .insertContent(" ")
      .run();
  }

  return (
    <div className="relative group">
      <button
        type="button"
        aria-label="Insert variable"
        className="inline-flex items-center gap-1 px-2 py-1.5 rounded text-foreground hover:bg-muted transition-colors text-xs"
      >
        <Variable className="h-3.5 w-3.5" />
        <span>Variable</span>
      </button>
      <div className="absolute top-full right-0 mt-1 hidden group-hover:block group-focus-within:block w-64 max-h-64 overflow-y-auto p-1 rounded border border-border bg-card shadow-lg z-10">
        {variables.map((v) => (
          <button
            key={v.path}
            type="button"
            onClick={() => insertVariable(v.path, v.description)}
            className="w-full text-left rounded p-2 hover:bg-muted text-xs"
          >
            <span className="block font-mono text-primary">
              {`{{${v.path}}}`}
            </span>
            <span className="block text-[10px] text-muted-foreground mt-0.5">
              {v.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Hydration ──────────────────────────────────────────────────────────

/**
 * Walk the input HTML and convert each `{{path}}` literal back into a
 * Mention node so the editor renders chips. Done as a string transform
 * because the editor accepts HTML and parses internally — turning
 * tokens into `<span data-type="mention" data-id="path">…</span>` is
 * what TipTap looks for to recognize a mention on parse.
 *
 * Skips tokens inside attribute values to avoid matching e.g.
 * `href="{{cta.url}}"` as a chip — there are none in our templates,
 * but the guard is cheap.
 */
function hydrateMentions(html: string, variables: VariableOption[]): string {
  if (!html) return html;
  const known = new Set(variables.map((v) => v.path));
  // Match `{{ path.to.value }}` with optional whitespace, dot-paths only.
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path: string) => {
    // Resolve description if it's a known variable, otherwise still
    // render as a chip so the author sees what they typed.
    const v = variables.find((x) => x.path === path);
    const label = v?.description ?? path;
    if (!known.has(path)) {
      // Unknown variable — keep the text as-is. Author can fix.
      return match;
    }
    return `<span data-type="mention" data-id="${escapeHtml(path)}" data-label="${escapeHtml(label)}"></span>`;
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
