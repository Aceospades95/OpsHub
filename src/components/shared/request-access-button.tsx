"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { requestModuleAccess } from "@/actions/access-requests";

interface Props {
  module: string;
  moduleLabel: string;
}

export function RequestAccessButton({ module, moduleLabel }: Props) {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleRequest() {
    setLoading(true);
    try {
      await requestModuleAccess(module, moduleLabel);
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <p className="text-sm text-green-600 dark:text-green-400">
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
