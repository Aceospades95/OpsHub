"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { createUser } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";

const ROLES = ["VIEWER", "CONTRIBUTOR", "DEVELOPER", "MANAGER", "ADMIN"];

export function AddEmployeeButton({ managers }: { managers: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useFormState(createUser, null);
  const router = useRouter();

  if (state?.success) {
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4 mr-1" /> Add Employee
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">Add Employee</h2>
            <form action={action} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Full Name *</label>
                <input name="name" required className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
              </div>
              <div>
                <label className="text-sm font-medium">Email *</label>
                <input name="email" type="email" required className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
              </div>
              <div>
                <label className="text-sm font-medium">Password *</label>
                <input name="password" type="password" required minLength={6} className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Job Title</label>
                  <input name="jobTitle" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
                <div>
                  <label className="text-sm font-medium">System Role</label>
                  <select name="role" defaultValue="VIEWER" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background">
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Department</label>
                  <input name="department" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
                <div>
                  <label className="text-sm font-medium">Location</label>
                  <input name="location" placeholder="e.g. New York, NY" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Phone</label>
                  <input name="phone" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
                </div>
                <div>
                  <label className="text-sm font-medium">Reports To</label>
                  <select name="managerId" className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background">
                    <option value="">None</option>
                    {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>

              {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit">Create Employee</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
