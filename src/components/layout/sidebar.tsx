"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  FolderKanban,
  FileText,
  CheckSquare,
  Truck,
  Wrench,
  Globe,
  Shield,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface SidebarProps {
  visibleModules: string[];
}

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" },
  { label: "Clients", href: "/clients", icon: Building2, module: "clients" },
  { label: "Projects", href: "/projects", icon: FolderKanban, module: "projects" },
  { label: "Tasks", href: "/tasks", icon: CheckSquare, module: "tasks" },
  { label: "Contracts", href: "/contracts", icon: FileText, module: "contracts" },
  { label: "Suppliers", href: "/suppliers", icon: Truck, module: "suppliers" },
  { label: "Tools", href: "/tools", icon: Wrench, module: "tools" },
  { label: "Intranet", href: "/intranet", icon: Globe, module: "intranet" },
  { label: "Admin", href: "/admin/users", icon: Shield, module: "admin" },
];

export function Sidebar({ visibleModules }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  const filteredItems = navItems.filter(
    (item) => item.module === "dashboard" || item.module === "tasks" || visibleModules.includes(item.module)
  );

  return (
    <aside
      className={`flex flex-col border-r border-border bg-card transition-all duration-200 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      <div className="flex h-16 items-center justify-between border-b border-border px-4">
        {!collapsed && (
          <Link href="/dashboard" className="text-xl font-bold text-primary">
            OpsHub
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded p-1.5 hover:bg-muted transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {filteredItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
