"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Save, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  updateWorkflowEmailTemplate,
  deleteWorkflowEmailTemplate,
} from "@/actions/workflow-email-templates";
import {
  SUGGESTED_VARIABLES,
  substituteVariables,
} from "@/lib/workflows/step-types";

interface Props {
  template: {
    id: string;
    name: string;
    subject: string;
    bodyHtml: string;
    bodyText: string | null;
  };
  canDelete: boolean;
}

// Sample context used for the live preview pane. Picks values that cover
// every SUGGESTED_VARIABLES path so authors can eyeball substitution.
const PREVIEW_CONTEXT: Record<string, unknown> = {
  subject: {
    firstName: "Alex",
    lastName: "Rivera",
    fullName: "Alex Rivera",
    email: "alex@example.com",
    jobTitle: "Senior Engineer",
    department: "Engineering",
    startDate: new Date(),
  },
  manager: {
    firstName: "Sam",
    fullName: "Sam Lee",
    email: "sam@example.com",
  },
  company: {
    name: "Acme Corp",
  },
  workflow: {
    name: "Engineer onboarding",
    startDate: new Date(),
    targetDate: null,
  },
  portal: {
    url: "https://opshub.example.com/portal/abc123",
  },
};

export function EmailTemplateEditor({ template, canDelete }: Props) {
  const router = useRouter();
  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject);
  const [bodyHtml, setBodyHtml] = useState(template.bodyHtml);
  const [bodyText, setBodyText] = useState(template.bodyText ?? "");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pending, startTransition] = useTransition();
  const [activeField, setActiveField] = useState<
    "subject" | "bodyHtml" | "bodyText" | null
  >(null);
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyHtmlRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyTextRef = useRef<HTMLTextAreaElement | null>(null);

  // Live preview — substitute the sample context against current text.
  const renderedSubject = useMemo(
    () => substituteVariables(subject, PREVIEW_CONTEXT),
    [subject]
  );
  const renderedHtml = useMemo(
    () => substituteVariables(bodyHtml, PREVIEW_CONTEXT),
    [bodyHtml]
  );

  function insertVariable(path: string) {
    const token = `{{${path}}}`;
    if (activeField === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? subject.length;
      const end = el.selectionEnd ?? subject.length;
      setSubject(subject.slice(0, start) + token + subject.slice(end));
      // Restore focus after React re-renders.
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
      return;
    }
    if (activeField === "bodyHtml" && bodyHtmlRef.current) {
      const el = bodyHtmlRef.current;
      const start = el.selectionStart ?? bodyHtml.length;
      const end = el.selectionEnd ?? bodyHtml.length;
      setBodyHtml(bodyHtml.slice(0, start) + token + bodyHtml.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
      return;
    }
    if (activeField === "bodyText" && bodyTextRef.current) {
      const el = bodyTextRef.current;
      const start = el.selectionStart ?? bodyText.length;
      const end = el.selectionEnd ?? bodyText.length;
      setBodyText(bodyText.slice(0, start) + token + bodyText.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
      return;
    }
    // No field focused — append to the body as a sensible default.
    setBodyHtml(bodyHtml + token);
  }

  function handleSave() {
    setError(null);
    if (!name.trim() || !subject.trim() || !bodyHtml.trim()) {
      setError("Name, subject, and body are required");
      return;
    }
    startTransition(async () => {
      const res = await updateWorkflowEmailTemplate({
        id: template.id,
        name: name.trim(),
        subject: subject.trim(),
        bodyHtml,
        bodyText: bodyText.trim() || null,
      });
      if ("error" in res) {
        setError(res.error ?? "Could not save");
        return;
      }
      setSavedAt(new Date());
      router.refresh();
    });
  }

  function handleDelete() {
    if (
      !confirm(
        "Delete this email template? Any workflow steps that reference it will need to be updated."
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await deleteWorkflowEmailTemplate(template.id);
      if ("error" in res) {
        setError(res.error ?? "Could not delete");
        return;
      }
      router.push("/workflows/email-templates");
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            <Link href="/workflows/email-templates" className="hover:underline">
              Email templates
            </Link>{" "}
            ›{" "}
            <span className="font-mono">{template.id.slice(0, 8)}</span>
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-2xl font-bold bg-transparent border-0 outline-none focus:ring-0 p-0 w-full"
          />
        </div>
        <div className="flex items-center gap-2">
          {savedAt && (
            <span className="text-xs text-muted-foreground">
              Saved {savedAt.toLocaleTimeString()}
            </span>
          )}
          <Link href="/workflows/email-templates">
            <Button variant="outline">
              <X className="h-4 w-4 mr-2" />
              Close
            </Button>
          </Link>
          {canDelete && (
            <Button variant="destructive" onClick={handleDelete} disabled={pending}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          )}
          <Button onClick={handleSave} disabled={pending}>
            <Save className="h-4 w-4 mr-2" />
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Email content</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Subject
                </label>
                <input
                  ref={subjectRef}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  onFocus={() => setActiveField("subject")}
                  className="flex h-10 w-full rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Body (HTML)
                </label>
                <textarea
                  ref={bodyHtmlRef}
                  value={bodyHtml}
                  onChange={(e) => setBodyHtml(e.target.value)}
                  onFocus={() => setActiveField("bodyHtml")}
                  rows={14}
                  className="flex w-full rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 font-mono"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  HTML body. Use <code>{"{{path.to.value}}"}</code> tokens
                  for variable substitution.
                </p>
              </div>

              <Textarea
                ref={bodyTextRef}
                label="Plain text fallback (optional)"
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                onFocus={() => setActiveField("bodyText")}
                rows={6}
                placeholder="Auto-derived from HTML if blank"
                className="font-mono"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Live preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Preview against a sample context — the real email at run
                time pulls from the workflow instance&apos;s subject + manager.
              </p>
              <div className="rounded border border-border bg-muted/30 p-4">
                <p className="font-mono text-xs text-muted-foreground mb-2">
                  Subject:
                </p>
                <p className="font-medium mb-4">{renderedSubject}</p>
                <p className="font-mono text-xs text-muted-foreground mb-2">
                  Body:
                </p>
                <div
                  className="prose prose-sm max-w-none text-sm"
                  // dangerouslySetInnerHTML is safe here — the rendered
                  // HTML is the template author's own content rendered
                  // for their own preview, not user-supplied content.
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="lg:sticky lg:top-4">
            <CardHeader>
              <CardTitle className="text-base">Variables</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Click to insert at the cursor of the focused field.
              </p>
              <ul className="space-y-1">
                {SUGGESTED_VARIABLES.map((v) => (
                  <li key={v.path}>
                    <button
                      type="button"
                      onClick={() => insertVariable(v.path)}
                      className="w-full text-left rounded p-2 hover:bg-muted text-xs group"
                    >
                      <span className="font-mono text-primary group-hover:underline">
                        {`{{${v.path}}}`}
                      </span>
                      <span className="block text-muted-foreground text-[10px] mt-0.5">
                        {v.description}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
