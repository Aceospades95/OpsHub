"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Car,
  CalendarClock,
  Contact,
  Target,
  LayoutDashboard,
  Building2,
  FolderKanban,
  FileText,
  CheckSquare,
  Award,
  Users,
  Truck,
  HardHat,
  Handshake,
  Wrench,
  Blocks,
  Globe,
  ClipboardList,
  Settings,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import type { SidebarConfig, SidebarItemConfig } from "@/lib/sidebar-config";
import { SYSTEM_MODULES, getPermissionedModuleKeys } from "@/lib/modules";
import { SafeImg } from "@/components/ui/safe-img";

interface CustomPage {
  id: string;
  title: string;
  slug: string;
}

interface SidebarProps {
  userRole?: string;
  /**
   * Keys of permissioned modules the user may see, computed server-side by
   * getVisibleModules(). When provided, permissioned modules not in this
   * list are hidden. Undefined = no permission filtering (legacy behavior).
   */
  visibleModules?: string[];
  customPages?: CustomPage[];
  sidebarConfig?: SidebarConfig;
  /** Company name override (defaults to "OpsHub") */
  companyName?: string | null;
  /** Public URL of the uploaded company logo, or null to use the text fallback */
  companyLogoUrl?: string | null;
  /**
   * Module keys an admin hid org-wide (Settings → Modules). Applied on
   * top of permission gating; my/dashboard/settings can never be hidden.
   */
  hiddenModules?: string[];
}

const ICON_MAP: Record<string, LucideIcon> = {
  Home,
  Car,
  CalendarClock,
  Contact,
  Target,
  LayoutDashboard,
  Building2,
  FolderKanban,
  FileText,
  CheckSquare,
  Award,
  Users,
  Truck,
  HardHat,
  Handshake,
  Wrench,
  Blocks,
  Globe,
  ClipboardList,
  Settings,
};

// Default labels/hrefs/icons come from the canonical module registry so there
// are no divergent hardcoded lists. Use a local alias for readability.
const SYSTEM_DEFAULTS = SYSTEM_MODULES;

// Modules that require specific roles to appear in the sidebar at all.
// Permissioned modules (clients, projects, contracts, …) are driven by the
// server-computed `visibleModules` list instead — see shouldShowItem.
const ROLE_GATED: Record<string, (role: string) => boolean> = {
  settings: (role) => role === "ADMIN",
};

// Keys that participate in per-user permission gating; everything else
// (dashboard, tasks, intranet, settings) is role-/always-on.
const PERMISSIONED_KEYS = new Set(getPermissionedModuleKeys());

export function Sidebar({
  userRole = "",
  visibleModules,
  hiddenModules = [],
  customPages = [],
  sidebarConfig,
  companyName,
  companyLogoUrl,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Build a map of custom pages for quick lookup
  const customPageMap = new Map(customPages.map((p) => [`custom-${p.id}`, p]));
  const visibleModuleSet = visibleModules ? new Set(visibleModules) : null;

  const hiddenModuleSet = new Set(hiddenModules);
  const NEVER_HIDDEN = new Set(["my", "dashboard", "settings"]);

  function shouldShowItem(item: SidebarItemConfig): boolean {
    if (!item.visible) return false;

    const key = item.key;

    // Org-wide "hide until in use" toggle (Settings → Modules).
    if (hiddenModuleSet.has(key) && !NEVER_HIDDEN.has(key)) return false;

    // Custom page items
    if (key.startsWith("custom-")) {
      return customPageMap.has(key);
    }

    // Role-gated modules (e.g. admin settings)
    if (ROLE_GATED[key]) {
      return ROLE_GATED[key](userRole);
    }

    // Permissioned modules: only show what getVisibleModules() allowed.
    if (visibleModuleSet && PERMISSIONED_KEYS.has(key)) {
      return visibleModuleSet.has(key);
    }

    return true;
  }

  function getItemProps(item: SidebarItemConfig) {
    // Custom page
    if (item.key.startsWith("custom-")) {
      const page = customPageMap.get(item.key);
      if (!page) return null;
      return {
        label: item.label || page.title,
        href: `/sandbox/${page.id}`,
        Icon: ICON_MAP.Blocks || Blocks,
      };
    }

    // System module
    const sys = SYSTEM_DEFAULTS[item.key];
    if (!sys) return null;
    return {
      label: item.label || sys.label,
      href: sys.href,
      Icon: ICON_MAP[sys.icon] || Settings,
    };
  }

  // Use config sections or fall back to flat list
  const baseSections = sidebarConfig?.sections || [
    {
      id: "main",
      title: "",
      items: Object.keys(SYSTEM_DEFAULTS).map((key) => ({ key, visible: true })),
    },
  ];

  // Merge any new system modules not in saved config into the admin section
  const allConfigKeys = new Set(baseSections.flatMap((s) => s.items.map((i) => i.key)));
  const missingKeys = Object.keys(SYSTEM_DEFAULTS).filter((k) => !allConfigKeys.has(k));
  let sections = baseSections;
  if (missingKeys.length > 0) {
    const ADMIN_KEYS = new Set(["admin", "widgets", "theme", "sidebar", "sandbox"]);
    const mainMissing = missingKeys.filter((k) => !ADMIN_KEYS.has(k));
    const adminMissing = missingKeys.filter((k) => ADMIN_KEYS.has(k));

    sections = sections.map((s) => {
      if (s.id === "main" && mainMissing.length > 0) {
        return { ...s, items: [...s.items, ...mainMissing.map((k) => ({ key: k, visible: true }))] };
      }
      if (s.id === "admin-section" && adminMissing.length > 0) {
        return { ...s, items: [...s.items, ...adminMissing.map((k) => ({ key: k, visible: true }))] };
      }
      return s;
    });
  }

  const renderNavLink = (href: string, label: string, Icon: LucideIcon, key: string) => {
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
          <Link href="/dashboard" className="flex items-center gap-2 min-w-0">
            {companyLogoUrl ? (
              // Custom uploaded logo. SafeImg caches a 404 in-session so
              // a stale logo reference (file deleted from storage but
              // still pointed at by a ThemeSetting row) doesn't trigger
              // 22+ refetches across the page lifetime — the QA team
              // hit that on every navigation.
              <SafeImg
                src={companyLogoUrl}
                alt={companyName || "OpsHub"}
                className="h-8 w-auto max-w-[160px] object-contain"
                fallback={
                  <span className="text-xl font-bold text-primary truncate">
                    {companyName || "OpsHub"}
                  </span>
                }
              />
            ) : (
              <span className="text-xl font-bold text-primary truncate">
                {companyName || "OpsHub"}
              </span>
            )}
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:block rounded p-1.5 hover:bg-muted transition-colors"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden rounded p-1.5 hover:bg-muted transition-colors"
          aria-label="Close menu"
          title="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {sections.map((section) => {
          const visibleItems = section.items.filter(shouldShowItem);
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.id} className="mb-2">
              {section.title && !collapsed && (
                <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </div>
              )}
              {collapsed && section.title && (
                <div className="border-t border-border my-2" />
              )}
              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const props = getItemProps(item);
                  if (!props) return null;
                  return renderNavLink(props.href, props.label, props.Icon, item.key);
                })}
              </div>
            </div>
          );
        })}
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
