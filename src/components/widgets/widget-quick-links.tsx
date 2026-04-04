import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link as LinkIcon, LayoutDashboard, FolderKanban, Building2, FileText, CheckSquare, Users, Globe } from "lucide-react";
import Link from "next/link";

const defaultLinks = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Clients", href: "/clients", icon: Building2 },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Tasks", href: "/tasks", icon: CheckSquare },
  { label: "Contracts", href: "/contracts", icon: FileText },
  { label: "Intranet", href: "/intranet", icon: Globe },
];

export async function WidgetQuickLinks({ userId: _userId }: { userId: string }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <LinkIcon className="h-4 w-4" /> Quick Links
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {defaultLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-muted text-sm transition-colors"
              >
                <Icon className="h-4 w-4 text-primary/60" />
                {link.label}
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
