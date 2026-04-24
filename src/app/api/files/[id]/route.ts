/**
 * File serving route: GET /api/files/{id}
 *
 * Flow:
 *   1. Look up File metadata (no bytes loaded yet).
 *   2. Run the auth gate. Public files are served to anyone; private files
 *      require an authenticated session. This MUST happen before we touch
 *      the backing store so unauthorized requests don't trigger an S3 GET.
 *   3. If the file's driver supports presigned URLs (S3 and friends),
 *      redirect the browser there with a short-lived URL so bytes don't
 *      proxy through the Next.js server.
 *   4. Otherwise (local driver), stream bytes back through the response.
 *
 * No per-entity permission check yet — if you're signed in, you can read
 * any private file. When a feature needs stricter gating, add it here
 * based on file.entityType / file.entityId or the legacy FKs.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getFileForServing, readFile } from "@/lib/storage";

const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const meta = await getFileForServing(id);
  if (!meta) {
    return new NextResponse("File not found", { status: 404 });
  }

  if (meta.visibility !== "public") {
    const session = await auth();
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const disposition: "inline" | "attachment" =
    meta.contentType.startsWith("image/") || meta.contentType === "application/pdf"
      ? "inline"
      : "attachment";

  // If the driver can hand out a presigned URL, redirect there. This keeps
  // bytes off the application server.
  if (typeof meta.driver.getSignedUrl === "function") {
    const signedUrl = await meta.driver.getSignedUrl(meta.storageKey, {
      expiresIn: SIGNED_URL_TTL_SECONDS,
      contentType: meta.contentType,
      filename: meta.filename,
      disposition,
    });
    const response = NextResponse.redirect(signedUrl, 302);
    // The signed URL is short-lived and per-request; never cache the redirect.
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  // Fallback: stream bytes through the server (used by the local driver).
  const file = await readFile(id);
  if (!file) {
    return new NextResponse("File not found", { status: 404 });
  }

  const encodedName = encodeURIComponent(file.filename);
  const body = new Uint8Array(file.buffer.byteLength);
  body.set(file.buffer);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.buffer.length),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
      "Cache-Control":
        file.visibility === "public"
          ? "public, max-age=3600"
          : "private, max-age=0, must-revalidate",
    },
  });
}
