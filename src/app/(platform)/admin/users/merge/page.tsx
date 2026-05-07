import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MergeUsersClient } from "./merge-users-client";

export default async function MergeUsersPage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") {
    redirect("/admin/users");
  }

  // Pull a flat list of all users (active + inactive). The picker is a
  // searchable dropdown rather than a typeahead because admins
  // typically know which two rows they're consolidating; loading a
  // full list keeps the UI predictable.
  const users = await db.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      jobTitle: true,
      isActive: true,
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  return (
    <div>
      <PageHeader
        title="Merge Employees"
        description="Consolidate two employee rows into one. Use this when an SSO sign-in created a second account, or when an import / placeholder collision left a duplicate behind."
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">How this works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Pick the <strong>source</strong> (the row that will be deleted) and the{" "}
            <strong>keeper</strong> (the row that will absorb everything). Optionally rename
            the keeper&rsquo;s email after the merge.
          </p>
          <p>
            <strong>Preview</strong> shows what would change without writing anything.
            Hit <strong>Commit</strong> only after the preview matches your intent —
            the merge cannot be undone (no soft-delete, no recovery).
          </p>
          <p>
            Tasks, comments, assignments, project memberships, certifications, quotes,
            and the SSO Account row all get re-pointed at the keeper before the
            source row is deleted.
          </p>
        </CardContent>
      </Card>

      <MergeUsersClient users={users} />
    </div>
  );
}
