"use client";

import { useState, useEffect } from "react";
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
  Blocks,
  Globe,
  Shield,
  Palette,
  FileCode,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";

interface CustomPage {
  id: string;
  title: string;
  slug: string;
}

interface SidebarProps {
  visibleModules: string[];
  userRole?: string;
  customPages?: CustomPage[];
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
  { label: "Custom Pages", href: "/sandbox", icon: Blocks, module: "sandbox" },
  { label: "Admin", href: "/admin/users", icon: Shield, module: "admin" },
  { label: "Theme", href: "/admin/theme", icon: Palette, module: "admin" },
];

export function Sidebar({ visibleModules, userRole, customPages = [] }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const filteredItems = navItems.filter(
    (item) => {
      if (item.module === "dashboard" || item.module === "tasks") return true;
      if (item.module === "sandbox") return userRole === "ADMIN" || userRole === "DEVELOPER";
      return visibleModules.includes(item.module);
    }
  );

  const renderNavLink = (
    href: string,
    label: string,
    Icon: React.ElementType,
    key: string,
  ) => {
    const isActive = pathname === href || pathname.startsWith(href + "/");
    return (
      <Link
        key={key}
        href={href}
        className={`flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        title={collapsed ? label : undefined}
      >
        <Icon className="h-5 w-5 shrink-0" />
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
    );
  };

  const navContent = (
    <>
      <div className="flex h-16 items-center justify-between border-b border-border px-4">
        {!collapsed && (
          <Link href="/dashboard" className="text-xl font-bold text-primary">
            OpsHub
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:block rounded p-1.5 hover:bg-muted transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden rounded p-1.5 hover:bg-muted transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {filteredItems.map((item) =>
          renderNavLink(item.href, item.label, item.icon, item.href)
        )}

        {/* Published custom pages */}
        {customPages.length > 0 && (
          <>
            {!collapsed && (
              <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pages
              </div>
            )}
            {customPages.map((page) =>
              renderNavLink(`/sandbox/${page.id}`, page.title, FileCode, `custom-${page.id}`)
            )}
          </>
        )}
      </nav>
    </>
  );

  return (
    <>
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-4 left-4 z-40 rounded p-2 bg-card border border-border shadow-sm hover:bg-muted transition-colors"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-60 flex flex-col bg-card border-r border-border transform transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {navContent}
      </aside>

      <aside
        className={`hidden md:flex flex-col border-r border-border bg-card transition-all duration-200 ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        {navContent}
      </aside>
    </>
  );
}
