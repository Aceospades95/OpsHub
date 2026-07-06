import { Badge } from "@/components/ui/badge";

type BadgeVariant = "default" | "secondary" | "success" | "warning" | "destructive" | "outline";

const statusVariantMap: Record<string, BadgeVariant> = {
  // Client statuses
  ACTIVE: "success",
  INACTIVE: "secondary",
  PROSPECT: "warning",
  ARCHIVED: "outline",

  // Project statuses
  PLANNING: "secondary",
  ON_HOLD: "warning",
  COMPLETED: "default",

  // Certification renewal-in-progress (date-derived display state)
  RENEWAL_SUBMITTED: "default",

  // Vehicle statuses
  IN_SHOP: "warning",
  RETIRED: "outline",
  SOLD: "secondary",

  // Contract statuses
  DRAFT: "outline",
  UNDER_REVIEW: "warning",
  EXPIRING_SOON: "warning",
  EXPIRED: "destructive",
  TERMINATED: "destructive",
  RENEWED: "success",

  // Sandbox statuses
  PUBLISHED: "success",

  // Task statuses
  TODO: "outline",
  IN_PROGRESS: "default",
  DONE: "success",
  CANCELLED: "secondary",

  // Priority
  HIGH: "destructive",
  MEDIUM: "warning",
  LOW: "secondary",

  // Quote statuses
  SENT: "default",
  VIEWED: "default",
  ACCEPTED: "success",
  REJECTED: "destructive",
  REVISED: "secondary",
};

function formatLabel(status: string): string {
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const variant = statusVariantMap[status] || "outline";
  return (
    <Badge variant={variant} className={className}>
      {formatLabel(status)}
    </Badge>
  );
}
