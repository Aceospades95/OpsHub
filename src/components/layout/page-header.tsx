interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  // The header WRAPS instead of squeezing: pages with heavy toolbars
  // (Tasks carries six controls ≈ 678px) used to crush the title block
  // to ~128px and line-clamp the subtitle despite a screen full of
  // space. The title claims a 320px basis and grows; the toolbar drops
  // to its own line when the two can't share one.
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 mb-8">
      <div className="min-w-0 flex-[1_1_320px]">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground truncate">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
