"use client";

/**
 * Files tab on the employee detail page.
 *
 * Renders the employee's profile files grouped by category, with an
 * upload form at the top and a trash button next to each file. All
 * state comes in from the server as serialized data — the component
 * calls the server action and then router.refresh() to reload.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileText,
  FileImage,
  FileSpreadsheet,
  FileIcon,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  uploadEmployeeFile,
  deleteEmployeeFile,
  EMPLOYEE_FILE_CATEGORIES,
  type EmployeeFileCategory,
} from "@/actions/employee-files";

interface EmployeeFile {
  id: string;
  name: string;
  url: string;
  size: number | null;
  mimeType: string | null;
  category: string | null;
  createdAt: string;
  uploadedBy: { id: string; name: string } | null;
}

interface Props {
  employeeId: string;
  employeeName: string;
  files: EmployeeFile[];
  canUpload: boolean;
  canDelete: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  resume: "Resume",
  id: "ID documents",
  certification: "Certifications",
  training: "Training records",
  contract: "Employment docs",
  other: "Other",
};

function iconForFile(mimeType: string | null) {
  if (!mimeType) return FileIcon;
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.includes("sheet") || mimeType.includes("excel") || mimeType === "text/csv") {
    return FileSpreadsheet;
  }
  if (mimeType === "application/pdf" || mimeType.startsWith("text/") || mimeType.includes("word")) {
    return FileText;
  }
  return FileIcon;
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function EmployeeFilesTab({
  employeeId,
  employeeName,
  files,
  canUpload,
  canDelete,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [category, setCategory] = useState<EmployeeFileCategory>("resume");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const form = e.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      setError("Pick a file first");
      return;
    }

    const formData = new FormData(form);
    formData.set("userId", employeeId);
    formData.set("category", category);

    startTransition(async () => {
      const result = await uploadEmployeeFile(null, formData);
      if (!result.success) {
        setError(result.error || "Upload failed");
        return;
      }
      setSuccess(`Uploaded ${input.files![0].name}`);
      form.reset();
      router.refresh();
    });
  };

  const handleDelete = (fileId: string, filename: string) => {
    if (!confirm(`Delete "${filename}"? This can't be undone.`)) return;
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const result = await deleteEmployeeFile(fileId);
      if (!result.success) {
        setError(result.error || "Delete failed");
        return;
      }
      setSuccess("File deleted");
      router.refresh();
    });
  };

  // Bucket files by category for display. "other" is always last.
  const byCategory = files.reduce<Record<string, EmployeeFile[]>>((acc, f) => {
    const key = f.category || "other";
    (acc[key] = acc[key] || []).push(f);
    return acc;
  }, {});
  const orderedCategories = [
    ...EMPLOYEE_FILE_CATEGORIES.filter((k) => byCategory[k]?.length),
  ];

  return (
    <div className="space-y-6">
      {canUpload && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Upload a file
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1">
                  <label className="block text-xs font-medium mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as EmployeeFileCategory)}
                    className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {EMPLOYEE_FILE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium mb-1">File</label>
                  <input
                    ref={fileRef}
                    type="file"
                    name="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*"
                    className="w-full text-sm file:mr-2 file:rounded file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-xs"
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Max 10MB. Accepted: PDF, Word, Excel, PowerPoint, text, and common images.
                Files are private to {employeeName}, their manager, and admins.
              </p>
              {error && (
                <div className="rounded bg-destructive/10 p-2 text-xs text-destructive flex items-center gap-2">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {error}
                </div>
              )}
              {success && (
                <div className="rounded bg-emerald-500/10 p-2 text-xs text-emerald-700 flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  {success}
                </div>
              )}
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Upload className="h-3 w-3 mr-1.5" />
                      Upload
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Files ({files.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {files.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <FileIcon className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No files uploaded yet.</p>
              {canUpload && (
                <p className="text-xs mt-1">
                  Use the form above to add a resume, ID, or training record.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {orderedCategories.map((cat) => (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                      {CATEGORY_LABELS[cat]}
                    </h3>
                    <Badge variant="outline" className="text-[10px]">
                      {byCategory[cat].length}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {byCategory[cat].map((f) => {
                      const Icon = iconForFile(f.mimeType);
                      return (
                        <div
                          key={f.id}
                          className="flex items-center gap-3 rounded border border-border p-3"
                        >
                          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <a
                              href={f.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium hover:text-primary hover:underline truncate block"
                            >
                              {f.name}
                            </a>
                            <p className="text-[11px] text-muted-foreground">
                              {formatSize(f.size)}
                              {f.uploadedBy && (
                                <>
                                  {f.size !== null ? " · " : ""}
                                  Uploaded by {f.uploadedBy.name}{" "}
                                  {formatDistanceToNow(new Date(f.createdAt), {
                                    addSuffix: true,
                                  })}
                                </>
                              )}
                            </p>
                          </div>
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(f.id, f.name)}
                              className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                              disabled={isPending}
                              title="Delete file"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
