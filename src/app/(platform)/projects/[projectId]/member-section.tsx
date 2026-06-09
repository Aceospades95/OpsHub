"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { useConfirm } from "@/components/shared/use-confirm";
import { addProjectMember, removeProjectMember } from "@/actions/projects";
import { Plus, X } from "lucide-react";
import Link from "next/link";

interface Member {
  id: string;
  role: string;
  user: { id: string; name: string; email: string };
}

/**
 * Per-role hover hints. Project roles are scoped to a single project
 * — distinct from the user's system-wide role. The QA stress test
 * flagged that the "ADMIN" pill on the project access list had no
 * tooltip, which left admins guessing what each role actually grants.
 */
const ROLE_TOOLTIPS: Record<string, string> = {
  VIEWER: "Read-only access to this project's data and comments.",
  CONTRIBUTOR:
    "Can comment, upload attachments, and edit their own contributions on this project.",
  MANAGER:
    "Can edit project metadata, manage staffing on this project, and add or remove members. Cannot delete the project.",
  ADMIN:
    "Full control over this project — edit, staff, manage members, delete. Scoped to this project only; doesn't change the user's system role.",
  DEVELOPER:
    "Legacy role grandfathered from earlier versions. Treated as Manager-equivalent for this project.",
};

interface Props {
  members: Member[];
  projectId: string;
  allUsers: { id: string; name: string; email: string }[];
  canEdit: boolean;
}

export function MemberSection({ members, projectId, allUsers, canEdit }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const router = useRouter();

  const memberUserIds = new Set(members.map((m) => m.user.id));
  const availableUsers = allUsers.filter((u) => !memberUserIds.has(u.id));

  async function handleAdd(formData: FormData) {
    formData.set("projectId", projectId);
    const result = await addProjectMember(null, formData);
    if (result && "error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    setAddOpen(false);
    router.refresh();
  }

  async function handleRemove(id: string, userName: string) {
    const ok = await confirm({
      title: `Remove ${userName} from this project?`,
      message: "They will lose their project-scoped access immediately.",
      confirmLabel: "Remove",
    });
    if (!ok) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const result = await removeProjectMember(null, fd);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Member removed");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {members.map((member) => (
        <div key={member.id} className="flex items-center gap-2">
          <Avatar name={member.user.name} size="xs" />
          <Link href={`/team/${member.user.id}`} className="flex-1 min-w-0 hover:text-primary hover:underline">
            <p className="text-sm font-medium truncate">{member.user.name}</p>
          </Link>
          <span title={ROLE_TOOLTIPS[member.role] ?? "Project member"}>
            <Badge variant="outline" className="text-xs">
              {member.role}
            </Badge>
          </span>
          {canEdit && (
            <button
              onClick={() => handleRemove(member.id, member.user.name)}
              disabled={isPending}
              aria-label={`Remove ${member.user.name} from this project`}
              className="text-muted-foreground hover:text-destructive disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}

      {canEdit && (
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Member
          </Button>
          <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add Team Member">
            <form action={handleAdd} className="space-y-4">
              <Select
                name="userId"
                label="User"
                options={availableUsers.map((u) => ({ label: `${u.name} (${u.email})`, value: u.id }))}
                placeholder="Select a user"
                required
              />
              <Select
                name="role"
                label="Project Role"
                options={[
                  { label: "Viewer — read-only access", value: "VIEWER" },
                  { label: "Contributor — comment + edit own", value: "CONTRIBUTOR" },
                  { label: "Manager — edit project + add others", value: "MANAGER" },
                  { label: "Admin — full control on this project", value: "ADMIN" },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                Project roles are scoped to this project only — they don&rsquo;t change
                the user&rsquo;s system-wide role.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button type="submit">Add</Button>
              </div>
            </form>
          </Dialog>
        </>
      )}
      <ConfirmDialog />
    </div>
  );
}
