"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { requestAccess } from "@/actions/access-requests";

interface Props {
  module: string;
  moduleLabel: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
}

export function RequestAccessButton({ module, moduleLabel, entityType, entityId, entityLabel }: Props) {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleRequest() {
    setLoading(true);
    try {
      await requestAccess({ module, moduleLabel, entityType, entityId, entityLabel });
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <p className="text-sm text-success">
        Access request sent to your admin.
      </p>
    );
  }

  return (
    <Button onClick={handleRequest} disabled={loading} size="sm">
      {loading ? "Sending..." : "Request Access"}
    </Button>
  );
}
