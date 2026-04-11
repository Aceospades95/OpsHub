import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HardDrive, FileIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { FilesAdminActions } from "./files-admin-actions";

export default async function AdminFilesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const [files, driverStats, totalBytes] = await Promise.all([
    db.file.findMany({
      where: { storageDriver: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { uploadedBy: { select: { id: true, name: true } } },
    }),
    db.file.groupBy({
      by: ["storageDriver"],
      where: { storageDriver: { not: null } },
      _count: { _all: true },
      _sum: { size: true },
    }),
    db.file.aggregate({
      where: { storageDriver: { not: null } },
      _sum: { size: true },
      _count: { _all: true },
    }),
  ]);

  const activeDriver = process.env.STORAGE_DRIVER || "local";
  const totalCount = totalBytes._count._all;
  const totalSize = totalBytes._sum.size || 0;

  return (
    <div>
      <PageHeader
        title="File Storage"
        description="Uploaded files routed through the storage layer"
        actions={<FilesAdminActions />}
      />

      {/* Active driver banner */}
      <Card className="mb-6">
        <CardContent className="py-4 flex items-center gap-3">
          <HardDrive className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm">
              Active driver:{" "}
              <Badge variant="outline" className="font-mono">{activeDriver}</Badge>
            </p>
            {activeDriver === "local" && (
              <p className="text-xs text-muted-foreground mt-1">
                The local driver stores files under <code>.storage/files/</code> (or <code>STORAGE_LOCAL_DIR</code>).
                Register a new driver in <code>src/lib/storage/drivers.ts</code> to switch to S3 or Google Drive.
              </p>
            )}
          </div>
          <div className="flex gap-4">
            <div className="text-center">
              <p className="text-2xl font-semibold">{totalCount}</p>
              <p className="text-xs text-muted-foreground">Files</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold">{formatBytes(totalSize)}</p>
              <p className="text-xs text-muted-foreground">Total size</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-driver breakdown */}
      {driverStats.length > 1 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By driver</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              {driverStats.map((s) => (
                <div key={s.storageDriver} className="rounded border border-border px-3 py-2">
                  <p className="text-xs text-muted-foreground font-mono">{s.storageDriver}</p>
                  <p className="text-sm font-medium">
                    {s._count._all} files · {formatBytes(s._sum.size || 0)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent uploads */}
      <Card>
        <CardHeader>
          <CardTitle>Recent (last 50)</CardTitle>
        </CardHeader>
        <CardContent>
          {files.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <FileIcon className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No files uploaded through the storage layer yet.</p>
              <p className="text-xs mt-2">Use the upload form above to test the pipeline.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-start gap-3 rounded border border-border p-3 hover:bg-muted/30 transition-colors"
                >
                  <FileIcon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/api/files/${file.id}`}
                        className="text-sm font-medium truncate hover:text-primary hover:underline"
                        target="_blank"
                      >
                        {file.name}
                      </Link>
                      <Badge variant="outline" className="text-[10px]">
                        {file.visibility}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {file.storageDriver}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {file.mimeType || "unknown"} · {formatBytes(file.size || 0)} ·{" "}
                      {file.uploadedBy && (
                        <>
                          uploaded by{" "}
                          <Link href={`/team/${file.uploadedBy.id}`} className="hover:text-primary hover:underline">
                            {file.uploadedBy.name}
                          </Link>
                        </>
                      )}
                    </p>
                    {file.storageKey && (
                      <p className="text-[10px] text-muted-foreground/70 mt-1 font-mono break-all">
                        key: {file.storageKey}
                      </p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground text-right shrink-0">
                    {formatDistanceToNow(file.createdAt, { addSuffix: true })}
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
