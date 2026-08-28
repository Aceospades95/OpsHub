"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { setModuleHidden } from "@/actions/module-settings";

interface Row {
  key: string;
  label: string;
  description: string;
  section: string;
  hidden: boolean;
}

export function ModuleVisibilityList({ modules }: { modules: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistic mirror so the toggle flips immediately; rolls back on error.
  const [hiddenByKey, setHiddenByKey] = useState(
    () => new Map(modules.map((m) => [m.key, m.hidden]))
  );

  function toggle(key: string, hidden: boolean) {
    setHiddenByKey((m) => new Map(m).set(key, hidden));
    startTransition(async () => {
      const res = await setModuleHidden(key, hidden);
      if (!res.success) {
        setHiddenByKey((m) => new Map(m).set(key, !hidden));
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="divide-y divide-border rounded border border-border">
      {modules.map((m) => {
        const hidden = hiddenByKey.get(m.key) ?? false;
        return (
          <label
            key={m.key}
            className="flex items-start gap-3 p-3 text-sm cursor-pointer hover:bg-muted/30"
          >
            <input
              type="checkbox"
              checked={!hidden}
              disabled={pending}
              onChange={(e) => toggle(m.key, !e.target.checked)}
              className="mt-0.5"
              aria-label={`Show ${m.label} in the sidebar`}
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium flex items-center gap-2">
                {m.label}
                <Badge variant="outline" className="text-[10px]">
                  {m.section}
                </Badge>
                {hidden && (
                  <Badge variant="secondary" className="text-[10px]">
                    hidden
                  </Badge>
                )}
              </span>
              <span className="block text-xs text-muted-foreground">
                {m.description}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
