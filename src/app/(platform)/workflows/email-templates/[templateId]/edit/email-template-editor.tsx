"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Save, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { useConfirm } from "@/components/shared/use-confirm";
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
  const { confirm, ConfirmDialog } = useConfirm();
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const [subjectActive, setSubjectActive] = useState(false);

  // Live preview — substitute the sample context against current text.
  const renderedSubject = useMemo(
    () => substituteVariables(subject, PREVIEW_CONTEXT),
    [subject]
  );
  // HTML mode mirrors the runtime send path so the preview matches what
  // recipients actually see. PREVIEW_CONTEXT is a hardcoded fixture
  // here, but preserving the same escape contract keeps the preview
  // honest and prevents an admin-set fixture from misleading the
  // template author about what gets through.
  const renderedHtml = useMemo(
    () => substituteVariables(bodyHtml, PREVIEW_CONTEXT, "html"),
    [bodyHtml]
  );

  function insertSubjectVariable(path: string) {
    const el = subjectRef.current;
    const token = `{{${path}}}`;
    if (!el) {
      setSubject((s) => s + token);
      return;
    }
    const start = el.selectionStart ?? subject.length;
    const end = el.selectionEnd ?? subject.length;
    const next = subject.slice(0, start) + token + subject.slice(end);
    setSubject(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
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

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete this email template?",
      message:
        "Any workflow steps that reference it will need to be updated.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
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
                  onFocus={() => setSubjectActive(true)}
                  onBlur={() => setSubjectActive(false)}
                  className="flex h-10 w-full rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                />
                {subjectActive && (
                  <SubjectVariablePicker onInsert={insertSubjectVariable} />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Body
                </label>
                <RichTextEditor
                  value={bodyHtml}
                  onChange={setBodyHtml}
                  variables={SUGGESTED_VARIABLES}
                  placeholder="Hi {{subject.firstName}},"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Type in plain English. Use the toolbar for formatting.
                  Click the variable button to insert chips like{" "}
                  <span className="font-mono">{"{{subject.firstName}}"}</span> —
                  they render as the recipient&apos;s actual values when the
                  email is sent.
                </p>
              </div>

              <Textarea
                label="Plain text fallback (optional)"
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={5}
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
                  className="email-preview max-w-none"
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
                Use the toolbar inside the body editor to insert these as
                chips. The list below is here for reference.
              </p>
              <ul className="space-y-1">
                {SUGGESTED_VARIABLES.map((v) => (
                  <li key={v.path} className="rounded p-2 text-xs">
                    <span className="font-mono text-primary">
                      {`{{${v.path}}}`}
                    </span>
                    <span className="block text-muted-foreground text-[10px] mt-0.5">
                      {v.description}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
      <ConfirmDialog />
    </div>
  );
}

// Compact picker that drops in below the subject input when it's
// focused — gives authors variable-insertion access on the subject
// line too, since the rich text editor only owns the body field.
function SubjectVariablePicker({
  onInsert,
}: {
  onInsert: (path: string) => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {SUGGESTED_VARIABLES.slice(0, 6).map((v) => (
        <button
          key={v.path}
          type="button"
          // onMouseDown so the click registers BEFORE the input's blur
          // handler fires and tears down the picker.
          onMouseDown={(e) => {
            e.preventDefault();
            onInsert(v.path);
          }}
          className="text-[10px] font-mono bg-primary/10 text-primary rounded px-1.5 py-0.5 hover:bg-primary/20"
        >
          {`{{${v.path}}}`}
        </button>
      ))}
    </div>
  );
}
