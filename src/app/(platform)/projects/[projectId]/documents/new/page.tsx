"use client";

import { useFormState } from "react-dom";
import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { createDocument } from "@/actions/documents";

export default function NewDocumentPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [state, formAction] = useFormState(createDocument, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) {
      router.push(`/projects/${projectId}`);
    }
  }, [state, router, projectId]);

  return (
    <div>
      <PageHeader title="Create Document" description="Add a new document to this project" />

      <Card>
        <CardContent className="p-6">
          {state?.error && (
            <div className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">{state.error}</div>
          )}
          <form action={formAction} className="space-y-4 max-w-2xl">
            <input type="hidden" name="projectId" value={projectId} />
            <Input name="title" label="Title" required error={state?.fieldErrors?.title?.[0]} />
            <Select
              name="type"
              label="Document Type"
              options={[
                { label: "SOP", value: "SOP" },
                { label: "Guide", value: "GUIDE" },
                { label: "Policy", value: "POLICY" },
                { label: "Reference", value: "REFERENCE" },
                { label: "Template", value: "TEMPLATE" },
                { label: "Other", value: "OTHER" },
              ]}
            />
            <Textarea name="content" label="Content" className="min-h-[300px]" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="published" value="true" className="rounded" />
              Published
            </label>
            <div className="flex gap-2">
              <Button type="submit">
                Create Document
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
