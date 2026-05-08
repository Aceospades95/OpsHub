import { SafeImg } from "@/components/ui/safe-img";

type AvatarSize = "xs" | "sm" | "md" | "lg";

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: AvatarSize;
  className?: string;
}

const sizeStyles: Record<AvatarSize, string> = {
  xs: "h-6 w-6 text-xs",
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-base",
  lg: "h-14 w-14 text-lg",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function Avatar({ src, name, size = "md", className = "" }: AvatarProps) {
  const initials = (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground font-medium ${sizeStyles[size]} ${className}`}
    >
      {getInitials(name)}
    </span>
  );

  if (!src) return initials;

  // SafeImg caches in-session 404s so a stale user.avatar reference
  // (the file was deleted from storage but the User row still points
  // at it) doesn't refetch on every render. The fallback renders the
  // same initial-circle the no-src branch would have shown.
  return (
    <SafeImg
      src={src}
      alt={name}
      className={`inline-flex items-center justify-center rounded-full object-cover ${sizeStyles[size]} ${className}`}
      fallback={initials}
    />
  );
}
