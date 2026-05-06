type BadgeVariant = "default" | "secondary" | "success" | "warning" | "destructive" | "outline";

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

// Every variant carries a 1px border so a row of mixed badges (filled
// `success` next to an `outline`) stays the same height. Filled
// variants use a transparent border that matches their background's
// outer edge; the outline variant uses the visible border-border color.
const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-primary text-primary-foreground border border-transparent",
  secondary: "bg-secondary text-secondary-foreground border border-transparent",
  success: "bg-success text-white border border-transparent",
  warning: "bg-warning text-white border border-transparent",
  destructive: "bg-destructive text-white border border-transparent",
  outline: "border border-border text-foreground bg-transparent",
};

export function Badge({ variant = "default", children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium leading-5 ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
