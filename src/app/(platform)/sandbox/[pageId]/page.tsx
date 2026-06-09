import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { canAccessSandbox } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { SandboxPageActions } from "./sandbox-page-actions";
import type { Role } from "@prisma/client";

interface Props {
  params: Promise<{ pageId: string }>;
}

export default async function SandboxDetailPage({ params }: Props) {
  const { pageId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessSandbox(session.user.role as Role)) redirect("/dashboard");

  // Resolve by slug-or-id — the sidebar / detail UI display /sandbox/<slug>
  // URLs while old links use the cuid. Mirrors the intranet detail page.
  const page = await db.sandboxPage.findFirst({
    where: { OR: [{ id: pageId }, { slug: pageId }] },
    include: {
      createdBy: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  });

  if (!page) notFound();

  const isAdmin = session.user.role === "ADMIN";
  const isOwner = page.createdById === session.user.id;

  // Non-admin, non-owner can only see published pages
  if (!isAdmin && !isOwner && !page.published) redirect("/sandbox");

  const canEdit = isAdmin || isOwner;
  const canDelete = isAdmin || isOwner;

  const [projects, clients] = await Promise.all([
    db.project.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.client.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader
        title={page.title}
        description={page.description || undefined}
        actions={
          (canEdit || canDelete) ? (
            <SandboxPageActions
              page={page}
              canEdit={canEdit}
              canDelete={canDelete}
              isAdmin={isAdmin}
              projects={projects}
              clients={clients}
            />
          ) : undefined
        }
      />

      <div className="flex items-center gap-3 mb-6">
        {page.published ? (
          <Badge variant="success">Published</Badge>
        ) : (
          <Badge variant="secondary">Draft</Badge>
        )}
        <Badge variant="outline">{page.layout} layout</Badge>
        <span className="text-sm text-muted-foreground">/sandbox/{page.slug}</span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {page.content ? (
            <Card>
              <CardHeader>
                <CardTitle>Content</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm whitespace-pre-wrap">{page.content}</div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <p>This sandbox page has no content yet.</p>
                <p className="text-xs mt-1">Edit the page to add content.</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Created by</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Avatar name={page.createdBy.name} size="xs" />
                    <span className="font-medium">{page.createdBy.name}</span>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground">Last updated</p>
                  <p className="font-medium">{formatDistanceToNow(page.updatedAt, { addSuffix: true })}</p>
                </div>
                {page.client && (
                  <div>
                    <p className="text-muted-foreground">Client</p>
                    <Link href={`/clients/${page.client.id}`} className="text-primary hover:underline">
                      {page.client.name}
                    </Link>
                  </div>
                )}
                {page.project && (
                  <div>
                    <p className="text-muted-foreground">Project</p>
                    <Link href={`/projects/${page.project.id}`} className="text-primary hover:underline">
                      {page.project.name}
                    </Link>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
