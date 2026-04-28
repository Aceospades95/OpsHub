"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, ExternalLink, Save } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { updateUser } from "@/actions/admin";

/**
 * Side drawer that opens when an admin/manager clicks a card in the
 * org chart. Lets them tweak the high-impact fields — name, title,
 * department, location, manager — without navigating away. The full
 * /team/[id] page stays the canonical edit surface for everything
 * else; this is just the quick-fix for org-chart maintenance.
 *
 * Wires through the existing `updateUser` server action so the
 * permission gates and revalidation paths line up with the admin
 * users page.
 */

interface UserLite {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  managerId: string | null;
  isActive: boolean;
}

interface Props {
  user: UserLite | null;
  /** Other users available as a manager option. The drawer's owner is
   *  expected to filter out the current user + anyone whose ancestry
   *  would cycle through them. */
  managerOptions: { id: string; name: string }[];
  onClose: () => void;
}

export function OrgEditDrawer({ user, managerOptions, onClose }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [managerId, setManagerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Re-seed local state every time the drawer opens for a different
  // user. Without this, opening Alice → close → open Bob would show
  // Alice's values until the next React render.
  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setJobTitle(user.jobTitle ?? "");
    setDepartment(user.department ?? "");
    setLocation(user.location ?? "");
    setManagerId(user.managerId ?? "");
    setError(null);
  }, [user]);

  if (!user) return null;

  function handleSave() {
    if (!user) return;
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    // updateUser expects a FormData since it's defined for the
    // existing /admin/users edit form. We adapt here so the drawer
    // doesn't have to know the form's shape.
    const fd = new FormData();
    fd.set("id", user.id);
    fd.set("name", name.trim());
    fd.set("email", user.email);
    fd.set("role", user.role);
    fd.set("jobTitle", jobTitle.trim());
    fd.set("department", department.trim());
    fd.set("location", location.trim());
    fd.set("managerId", managerId);
    fd.set("isActive", String(user.isActive));

    startTransition(async () => {
      const res = await updateUser(null, fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <>
      {/* Backdrop — clicking it closes without saving. The drawer is
          modal-feeling but lighter than a Dialog so the chart stays
          visible behind it. */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={() => onClose()}
      />
      <aside className="fixed top-0 right-0 z-50 h-full w-full max-w-md bg-card border-l border-border shadow-xl flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Quick edit
            </p>
            <h2 className="text-lg font-semibold truncate">{user.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Job title"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="e.g. Senior Project Manager"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
            <Input
              label="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <Select
            label="Reports to"
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            placeholder="No manager (top of org)"
            options={managerOptions.map((m) => ({
              label: m.name,
              value: m.id,
            }))}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="pt-2 border-t border-border">
            <Link
              href={`/team/${user.id}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open full profile
            </Link>
          </div>
        </div>

        <footer className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={pending}>
            <Save className="h-4 w-4 mr-2" />
            {pending ? "Saving…" : "Save"}
          </Button>
        </footer>
      </aside>
    </>
  );
}
