"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { addProjectMember, removeProjectMember } from "@/actions/projects";
import { Plus, X } from "lucide-react";
import Link from "next/link";

interface Member {
  id: string;
  role: string;
  user: { id: string; name: string; email: string };
}

interface Props {
  members: Member[];
  projectId: string;
  allUsers: { id: string; name: string; email: string }[];
  canEdit: boolean;
}

export function MemberSection({ members, projectId, allUsers, canEdit }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const router = useRouter();

  const memberUserIds = new Set(members.map((m) => m.user.id));
  const availableUsers = allUsers.filter((u) => !memberUserIds.has(u.id));

  async function handleAdd(formData: FormData) {
    formData.set("projectId", projectId);
    await addProjectMember(null, formData);
    setAddOpen(false);
    router.refresh();
  }

  async function handleRemove(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await removeProjectMember(null, fd);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {members.map((member) => (
        <div key={member.id} className="flex items-center gap-2">
          <Avatar name={member.user.name} size="xs" />
          <Link href={`/team/${member.user.id}`} className="flex-1 min-w-0 hover:text-primary hover:underline">
            <p className="text-sm font-medium truncate">{member.user.name}</p>
          </Link>
          <Badge variant="outline" className="text-xs">{member.role}</Badge>
          {canEdit && (
            <button onClick={() => handleRemove(member.id)} className="text-muted-foreground hover:text-destructive">
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
                  { label: "Viewer", value: "VIEWER" },
                  { label: "Contributor", value: "CONTRIBUTOR" },
                  { label: "Manager", value: "MANAGER" },
                  { label: "Admin", value: "ADMIN" },
                ]}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button type="submit">Add</Button>
              </div>
            </form>
          </Dialog>
        </>
      )}
    </div>
  );
}
