/**
 * File serving route: GET /api/files/{id}
 *
 * Looks up a File row, reads the bytes from its storage driver, and streams
 * them back to the browser with appropriate Content-Type and
 * Content-Disposition headers.
 *
 * Auth rules (kept simple on purpose — extend as features need it):
 * - Public files: served to any request, no auth required
 * - Private files: require an authenticated session. No per-entity permission
 *   check yet — if you're signed in, you can read any private file. When a
 *   specific feature (e.g., client documents) needs stricter gating, we can
 *   add permission checks here based on file.entityType/entityId or the
 *   legacy project/contract/etc. FKs.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readFile } from "@/lib/storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const file = await readFile(id);
  if (!file) {
    return new NextResponse("File not found", { status: 404 });
  }

  // Require auth for private files
  if (file.visibility !== "public") {
    const session = await auth();
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  // Encode the filename so browser save dialogs show the original name.
  // Use encodeURIComponent for anything non-ASCII and wrap in the RFC 5987
  // filename* format so modern browsers handle unicode correctly.
  const encodedName = encodeURIComponent(file.filename);
  const disposition =
    file.contentType.startsWith("image/") || file.contentType === "application/pdf"
      ? "inline"
      : "attachment";

  // Next's BodyInit wants a Uint8Array backed by ArrayBuffer (not
  // SharedArrayBuffer). Node's Buffer is backed by ArrayBufferLike in newer
  // type defs, so we copy into a fresh Uint8Array to satisfy the compiler.
  const body = new Uint8Array(file.buffer.byteLength);
  body.set(file.buffer);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.buffer.length),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
      // Don't cache private files aggressively; allow short cache for public
      "Cache-Control":
        file.visibility === "public"
          ? "public, max-age=3600"
          : "private, max-age=0, must-revalidate",
    },
  });
}
