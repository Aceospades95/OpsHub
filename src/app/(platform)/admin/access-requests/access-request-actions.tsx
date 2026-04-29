"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { approveAccessRequest, denyAccessRequest } from "@/actions/access-requests";
import { useRouter } from "next/navigation";

interface Props {
  requestId: string;
}

export function AccessRequestActions({ requestId }: Props) {
  const [loading, setLoading] = useState<"approve" | "deny" | null>(null);
  const [resolved, setResolved] = useState<"APPROVED" | "DENIED" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleApprove() {
    setLoading("approve");
    setError(null);
    try {
      const result = await approveAccessRequest(requestId);
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      setResolved("APPROVED");
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function handleDeny() {
    setLoading("deny");
    setError(null);
    try {
      const result = await denyAccessRequest(requestId);
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      setResolved("DENIED");
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  if (resolved) {
    return (
      <span className={`text-xs font-medium ${resolved === "APPROVED" ? "text-green-600" : "text-red-600"}`}>
        {resolved === "APPROVED" ? "Approved" : "Denied"}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={handleApprove}
          disabled={loading !== null}
        >
          {loading === "approve" ? "..." : "Approve"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleDeny}
          disabled={loading !== null}
        >
          {loading === "deny" ? "..." : "Deny"}
        </Button>
      </div>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
