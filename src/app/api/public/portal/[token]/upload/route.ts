import { NextResponse } from "next/server";

import { uploadFile } from "@/lib/storage";
import { getPortalSubject, loadPortalStep } from "@/lib/workflows/portal";

// File upload happens via FormData/multipart, which server actions don't
// natively support cleanly — so it lives as a route handler. After the
// bytes land we hand the new file id back to the caller, who then calls
// `finalizeWorkflowPortalDocument` to mark the workflow step complete.
//
// Two-step upload-then-finalize keeps the auth surface tight: bytes are
// validated and stored here under the token's authority; the workflow
// state transition is a separate, idempotent call.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_PREFIXES = [
  "image/",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.",
  "application/vnd.ms-",
  "text/",
];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const subject = await getPortalSubject(token);
  if (!subject) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  // Accept either a free-floating file (will be associated by the caller
  // later via finalizeWorkflowPortalDocument) or a file + step id pair
  // that the route can audit on the spot.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Multipart body required" }, { status: 400 });
  }

  const file = formData.get("file");
  const instanceStepId = formData.get("instanceStepId");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File exceeds the 10 MB upload limit` },
      { status: 413 }
    );
  }
  if (!ALLOWED_MIME_PREFIXES.some((p) => file.type.startsWith(p))) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || "(unknown)"}` },
      { status: 415 }
    );
  }

  // If a step id was supplied, verify it belongs to the subject before
  // accepting the upload. Without one we still accept the upload — the
  // caller may want to attach it via finalize after the fact.
  let resolvedStepId: string | null = null;
  if (typeof instanceStepId === "string" && instanceStepId.length > 0) {
    const resolved = await loadPortalStep(token, instanceStepId);
    if (!resolved) {
      return NextResponse.json(
        { error: "Step does not belong to this portal token" },
        { status: 403 }
      );
    }
    if (resolved.step.workflowStep.stepType !== "REQUEST_DOCUMENT") {
      return NextResponse.json(
        { error: "Step is not a document request" },
        { status: 400 }
      );
    }
    resolvedStepId = resolved.step.id;
  }

  // Read the file bytes once and hand to the storage layer.
  const buffer = Buffer.from(await file.arrayBuffer());

  const stored = await uploadFile({
    content: buffer,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    uploadedById: subject.subjectType === "EMPLOYEE" ? subject.subjectId : "system",
    visibility: "private",
    // Tag with the subject user id when EMPLOYEE so the file shows up
    // on the employee profile's Files tab as well.
    userId: subject.subjectType === "EMPLOYEE" ? subject.subjectId : undefined,
    category: "workflow",
  });

  return NextResponse.json({
    success: true,
    fileId: stored.id,
    instanceStepId: resolvedStepId,
  });
}
