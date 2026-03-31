"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { createUser } from "@/actions/admin";
import { Plus } from "lucide-react";

interface Props {
  allUsers: { id: string; name: string }[];
}

export function UserCreateButton({ allUsers }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> New User
      </Button>
      <FormDialog open={open} onClose={() => setOpen(false)} title="Create User" action={createUser} submitLabel="Create User">
        {({ fieldErrors }) => (
          <>
            <Input name="name" label="Full Name" required error={fieldErrors?.name?.[0]} />
            <Input name="email" label="Email" type="email" required error={fieldErrors?.email?.[0]} />
            <Input name="password" label="Password" type="password" required error={fieldErrors?.password?.[0]} />
            <Select
              name="role"
              label="Role"
              options={[
                { label: "Viewer", value: "VIEWER" },
                { label: "Contributor", value: "CONTRIBUTOR" },
                { label: "Manager", value: "MANAGER" },
                { label: "Admin", value: "ADMIN" },
              ]}
            />
            <Input name="department" label="Department" />
            <Input name="jobTitle" label="Job Title" />
            <Input name="phone" label="Phone" />
            <Select
              name="managerId"
              label="Manager"
              options={allUsers.map((u) => ({ label: u.name, value: u.id }))}
              placeholder="None"
            />
          </>
        )}
      </FormDialog>
    </>
  );
}
