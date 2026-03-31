"use client";

import { useRouter } from "next/navigation";
import { toggleUserActive } from "@/actions/admin";
import { Badge } from "@/components/ui/badge";

interface Props {
  userId: string;
  isActive: boolean;
}

export function ToggleActiveButton({ userId, isActive }: Props) {
  const router = useRouter();

  async function handleToggle() {
    const fd = new FormData();
    fd.set("id", userId);
    await toggleUserActive(null, fd);
    router.refresh();
  }

  return (
    <button onClick={handleToggle}>
      <Badge variant={isActive ? "success" : "destructive"}>
        {isActive ? "Active" : "Inactive"}
      </Badge>
    </button>
  );
}
