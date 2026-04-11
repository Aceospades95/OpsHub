"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { Dialog } from "@/components/ui/dialog";
import { updateUser, deleteUser } from "@/actions/admin";
import { Pencil, Trash2 } from "lucide-react";

interface Props {
  user: {
    id: string; name: string; email: string; role: string;
    department: string | null; jobTitle: string | null; location: string | null; phone: string | null;
    managerId: string | null; isActive: boolean;
  };
  allUsers: { id: string; name: string }[];
}

export function UserActions({ user, allUsers }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    const fd = new FormData();
    fd.set("id", user.id);
    const result = await deleteUser(null, fd);
    if (result.success) router.push("/team");
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
        <Pencil className="h-4 w-4 mr-1" /> Edit
      </Button>
      <FormDialog open={editOpen} onClose={() => setEditOpen(false)} title="Edit User" action={updateUser}>
        {({ fieldErrors }) => (
          <>
            <input type="hidden" name="id" value={user.id} />
            <Input name="name" label="Name" defaultValue={user.name} required error={fieldErrors?.name?.[0]} />
            <Input name="email" label="Email" type="email" defaultValue={user.email} required error={fieldErrors?.email?.[0]} />
            <Select name="role" label="Role" defaultValue={user.role} options={[{label:"Viewer",value:"VIEWER"},{label:"Contributor",value:"CONTRIBUTOR"},{label:"Developer",value:"DEVELOPER"},{label:"Manager",value:"MANAGER"},{label:"Admin",value:"ADMIN"}]} />
            <Input name="department" label="Department" defaultValue={user.department || ""} />
            <Input name="jobTitle" label="Job Title" defaultValue={user.jobTitle || ""} />
            <Input name="location" label="Location" defaultValue={user.location || ""} placeholder="e.g. New York, NY" />
            <Input name="phone" label="Phone" defaultValue={user.phone || ""} />
            <Select name="managerId" label="Manager" defaultValue={user.managerId || ""} options={allUsers.map(u => ({ label: u.name, value: u.id }))} placeholder="None" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" value="true" defaultChecked={user.isActive} className="rounded" />
              Active
            </label>
          </>
        )}
      </FormDialog>

      <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
        <Trash2 className="h-4 w-4 mr-1" /> Delete
      </Button>
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete User">
        <p className="text-sm text-muted-foreground mb-4">Delete <strong>{user.name}</strong>? This is irreversible.</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={handleDelete}>Delete</Button>
        </div>
      </Dialog>
    </div>
  );
}
