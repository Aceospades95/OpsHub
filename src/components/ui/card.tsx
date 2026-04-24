interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={`rounded-lg bg-card text-card-foreground ${className}`}
      style={{
        border: "1px solid var(--card-border)",
        boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 4px 12px -2px rgb(0 0 0 / 0.08)",
      }}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: CardProps) {
  // Card headers are NOT sticky by default. The prior version applied
  // `sticky top-0 z-[1]` globally which caused every card header in the
  // app to stick to the top of its scroll container — making Theme,
  // Projects, and any page with multiple stacked cards feel broken while
  // scrolling. If a specific card needs a sticky header, pass `className="sticky top-0 z-[1]"`
  // explicitly on that card only.
  return (
    <div
      className={`flex flex-col space-y-1.5 px-6 pt-5 pb-3 bg-card rounded-t-lg ${className}`}
      style={{ borderBottom: "1px solid var(--card-border)" }}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className = "" }: CardProps) {
  return <h3 className={`text-base font-semibold leading-none tracking-tight ${className}`}>{children}</h3>;
}

export function CardDescription({ children, className = "" }: CardProps) {
  return <p className={`text-sm text-muted-foreground ${className}`}>{children}</p>;
}

export function CardContent({ children, className = "" }: CardProps) {
  return <div className={`p-6 ${className}`}>{children}</div>;
}

export function CardFooter({ children, className = "" }: CardProps) {
  return <div className={`flex items-center p-6 pt-0 ${className}`}>{children}</div>;
}
