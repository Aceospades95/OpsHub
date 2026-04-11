/**
 * Module registry — the canonical source of truth for every module in OpsHub.
 *
 * Before this file existed, module metadata was hardcoded in at least six
 * places: sidebar config, permissions library, admin permissions UI, employee
 * permissions tab, saveModulePermissions action, and the search page. Lists
 * drifted out of sync — most notably, the admin permissions UI only showed 7
 * modules while getVisibleModules() gated 9, silently orphaning `team` and
 * `certifications` permissions.
 *
 * Rule: if you're adding a new module, add it here. Do not hardcode module
 * keys, labels, or hrefs anywhere else.
 */

export type ModuleKey =
  | "dashboard"
  | "clients"
  | "projects"
  | "tasks"
  | "team"
  | "contracts"
  | "certifications"
  | "suppliers"
  | "tools"
  | "intranet"
  | "sandbox"
  | "admin"
  | "widgets"
  | "theme"
  | "sidebar"
  | "emails";

export type PermissionFlag =
  | "canView"
  | "canEdit"
  | "canCreate"
  | "canDelete"
  | "canComment"
  | "canUpload"
  | "canManage";

export type ModuleSection = "main" | "resources" | "admin";

export interface ModuleDefinition {
  /** Unique key used for permissions, URLs, and references */
  key: ModuleKey;
  /** Display label shown in navigation and admin UIs */
  label: string;
  /** Canonical URL for the module */
  href: string;
  /**
   * Lucide icon name (as string — the sidebar resolves it to a component to
   * keep this file safe to import from both server and client code)
   */
  icon: string;
  /** Short description shown in Admin permissions UI */
  description: string;
  /** Which sidebar section this module belongs to */
  section: ModuleSection;
  /**
   * Whether this module participates in per-user permission gating.
   * Admin sub-modules (widgets, theme, sidebar, sandbox) inherit from the
   * parent "admin" module and don't have their own permission rows.
   */
  permissioned: boolean;
  /**
   * If true, only ADMIN role sees this module regardless of module permissions.
   * Used for admin-only modules like the permissions editor itself.
   */
  adminOnly?: boolean;
  /**
   * Which permission flags are meaningful for this module. Some modules
   * (e.g., intranet) don't have upload or comment semantics.
   */
  permissionFlags?: PermissionFlag[];
}

/** All permission flags that any module can use */
export const ALL_PERMISSION_FLAGS: PermissionFlag[] = [
  "canView",
  "canEdit",
  "canCreate",
  "canDelete",
  "canComment",
  "canUpload",
  "canManage",
];

/** Human-readable labels for permission flags */
export const PERMISSION_FLAG_LABELS: Record<PermissionFlag, string> = {
  canView: "View",
  canEdit: "Edit",
  canCreate: "Create",
  canDelete: "Delete",
  canComment: "Comment",
  canUpload: "Upload",
  canManage: "Manage",
};

/**
 * The canonical module list. Order here is the default sidebar order.
 *
 * When adding a new module, add it here once and the sidebar, admin UI,
 * permissions gating, and search will all pick it up automatically.
 */
export const MODULES: ModuleDefinition[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: "LayoutDashboard",
    description: "Home overview and widgets",
    section: "main",
    permissioned: false,
  },
  {
    key: "clients",
    label: "Clients",
    href: "/clients",
    icon: "Building2",
    description: "Client accounts, contacts, and relationships",
    section: "main",
    permissioned: true,
  },
  {
    key: "projects",
    label: "Projects",
    href: "/projects",
    icon: "FolderKanban",
    description: "Project portfolio, milestones, staffing, and documents",
    section: "main",
    permissioned: true,
  },
  {
    key: "tasks",
    label: "Tasks",
    href: "/tasks",
    icon: "CheckSquare",
    description: "Task tracking across projects and clients",
    section: "main",
    permissioned: false,
  },
  {
    key: "team",
    label: "Team",
    href: "/team",
    icon: "Users",
    description: "Employees, org chart, and staffing matrix",
    section: "main",
    permissioned: true,
  },
  {
    key: "contracts",
    label: "Contracts",
    href: "/contracts",
    icon: "FileText",
    description: "Contracts, SOWs, amendments, and renewals",
    section: "main",
    permissioned: true,
  },
  {
    key: "certifications",
    label: "Certifications",
    href: "/certifications",
    icon: "Award",
    description: "Compliance certifications and expirations",
    section: "main",
    permissioned: true,
  },
  {
    key: "suppliers",
    label: "Suppliers",
    href: "/suppliers",
    icon: "Truck",
    description: "Vendor and supplier management",
    section: "main",
    permissioned: true,
  },
  {
    key: "tools",
    label: "Tools",
    href: "/tools",
    icon: "Wrench",
    description: "Shared tools and linked resources",
    section: "main",
    permissioned: true,
  },
  {
    key: "intranet",
    label: "Intranet",
    href: "/intranet",
    icon: "Globe",
    description: "HR resources, policies, handbooks, and time off",
    section: "resources",
    permissioned: true,
  },
  {
    key: "sandbox",
    label: "Custom Pages",
    href: "/sandbox",
    icon: "Blocks",
    description: "User-built custom pages and sandbox experiments",
    section: "admin",
    permissioned: false,
  },
  {
    key: "admin",
    label: "Admin",
    href: "/admin/users",
    icon: "Shield",
    description: "User management, permissions, and system settings",
    section: "admin",
    permissioned: true,
    adminOnly: true,
  },
  {
    key: "widgets",
    label: "Widget Builder",
    href: "/admin/widgets",
    icon: "Puzzle",
    description: "Build and publish custom dashboard widgets",
    section: "admin",
    permissioned: false,
  },
  {
    key: "theme",
    label: "Theme",
    href: "/admin/theme",
    icon: "Palette",
    description: "Branding, color palette, and theme configuration",
    section: "admin",
    permissioned: false,
  },
  {
    key: "sidebar",
    label: "Sidebar",
    href: "/admin/sidebar",
    icon: "PanelLeft",
    description: "Sidebar section and ordering configuration",
    section: "admin",
    permissioned: false,
  },
  {
    key: "emails",
    label: "Email Log",
    href: "/admin/emails",
    icon: "Mail",
    description: "Outbound email audit log and test sender",
    section: "admin",
    permissioned: false,
  },
];

// ─── Lookup helpers ───────────────────────────────────────────────

const MODULE_MAP = new Map<string, ModuleDefinition>(
  MODULES.map((m) => [m.key, m])
);

/** Get a module by key. Returns undefined if unknown. */
export function getModule(key: string): ModuleDefinition | undefined {
  return MODULE_MAP.get(key);
}

/** Get a module by key, throwing if unknown. Use when you expect the key to be valid. */
export function requireModule(key: string): ModuleDefinition {
  const mod = MODULE_MAP.get(key);
  if (!mod) throw new Error(`Unknown module key: ${key}`);
  return mod;
}

/**
 * Return all modules that participate in per-user permission gating.
 * Use this to drive the admin permissions UI and saveModulePermissions.
 */
export function getPermissionedModules(): ModuleDefinition[] {
  return MODULES.filter((m) => m.permissioned);
}

/**
 * Return module keys that participate in permission gating.
 * Convenience wrapper returning just the strings.
 */
export function getPermissionedModuleKeys(): string[] {
  return getPermissionedModules().map((m) => m.key);
}

/** Return modules in a specific sidebar section. */
export function getModulesBySection(section: ModuleSection): ModuleDefinition[] {
  return MODULES.filter((m) => m.section === section);
}

/**
 * Effective permission flags for a module. Returns the module's declared
 * flags if set, otherwise the full list.
 */
export function getModulePermissionFlags(key: string): PermissionFlag[] {
  const mod = getModule(key);
  if (mod?.permissionFlags) return mod.permissionFlags;
  return ALL_PERMISSION_FLAGS;
}

/**
 * Legacy shape expected by sidebar-config.ts.
 * Kept as a computed export so existing sidebar code doesn't break.
 */
export const SYSTEM_MODULES: Record<string, { label: string; href: string; icon: string }> =
  Object.fromEntries(
    MODULES.map((m) => [m.key, { label: m.label, href: m.href, icon: m.icon }])
  );
