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
//
// Status variants (success/warning/destructive) are tinted rather than
// filled: white-on-mid-tone failed WCAG AA (warning was 2.15:1). The
// tint mixes the theme token with transparent for the surface/border
// and toward --foreground for the text, so the pair stays readable in
// BOTH light and dark themes (foreground flips with the theme, pulling
// the text darker on light surfaces and lighter on dark ones).
// color-mix() is used because the theme tokens are plain hex CSS vars —
// Tailwind can't compute `/15`-style alpha for them (no <alpha-value>).
const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-primary text-primary-foreground border border-transparent",
  secondary: "bg-secondary text-secondary-foreground border border-transparent",
  success:
    "bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[color-mix(in_srgb,var(--success)_60%,var(--foreground))] border border-[color-mix(in_srgb,var(--success)_30%,transparent)]",
  warning:
    "bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] text-[color-mix(in_srgb,var(--warning)_60%,var(--foreground))] border border-[color-mix(in_srgb,var(--warning)_30%,transparent)]",
  destructive:
    "bg-[color-mix(in_srgb,var(--destructive)_15%,transparent)] text-[color-mix(in_srgb,var(--destructive)_60%,var(--foreground))] border border-[color-mix(in_srgb,var(--destructive)_30%,transparent)]",
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
