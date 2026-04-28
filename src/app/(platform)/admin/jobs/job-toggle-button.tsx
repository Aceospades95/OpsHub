"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toggleJobEnabled } from "@/actions/jobs";

interface Props {
  jobKey: string;
  isEnabled: boolean;
}

export function JobToggleButton({ jobKey, isEnabled }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistic local state so the button feels snappy — server result
  // reconciles via router.refresh() in the same transition.
  const [optimistic, setOptimistic] = useState(isEnabled);

  const toggle = () => {
    const next = !optimistic;
    setOptimistic(next);
    startTransition(async () => {
      const res = await toggleJobEnabled(jobKey, next);
      if ("error" in res) {
        // Revert on failure
        setOptimistic(!next);
        return;
      }
      router.refresh();
    });
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={toggle}
      disabled={pending}
      title={optimistic ? "Click to pause this job" : "Click to resume this job"}
    >
      {optimistic ? (
        <>
          <Power className="h-3 w-3 mr-1" />
          Enabled
        </>
      ) : (
        <>
          <PowerOff className="h-3 w-3 mr-1" />
          Paused
        </>
      )}
    </Button>
  );
}
