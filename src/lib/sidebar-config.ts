export interface SidebarItemConfig {
  key: string;       // "dashboard", "clients", or "custom-page-{id}"
  label?: string;    // override default label
  visible: boolean;
}

export interface SidebarSectionConfig {
  id: string;
  title: string;
  items: SidebarItemConfig[];
}

export interface SidebarConfig {
  sections: SidebarSectionConfig[];
}

// System modules with their defaults
export const SYSTEM_MODULES: Record<string, { label: string; href: string; icon: string }> = {
  dashboard: { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" },
  clients: { label: "Clients", href: "/clients", icon: "Building2" },
  projects: { label: "Projects", href: "/projects", icon: "FolderKanban" },
  tasks: { label: "Tasks", href: "/tasks", icon: "CheckSquare" },
  contracts: { label: "Contracts", href: "/contracts", icon: "FileText" },
  certifications: { label: "Certifications", href: "/certifications", icon: "Award" },
  suppliers: { label: "Suppliers", href: "/suppliers", icon: "Truck" },
  tools: { label: "Tools", href: "/tools", icon: "Wrench" },
  intranet: { label: "Intranet", href: "/intranet", icon: "Globe" },
  sandbox: { label: "Custom Pages", href: "/sandbox", icon: "Blocks" },
  admin: { label: "Admin", href: "/admin/users", icon: "Shield" },
  widgets: { label: "Widget Builder", href: "/admin/widgets", icon: "Puzzle" },
  theme: { label: "Theme", href: "/admin/theme", icon: "Palette" },
  sidebar: { label: "Sidebar", href: "/admin/sidebar", icon: "PanelLeft" },
};

export const DEFAULT_SIDEBAR_CONFIG: SidebarConfig = {
  sections: [
    {
      id: "main",
      title: "",
      items: [
        { key: "dashboard", visible: true },
        { key: "clients", visible: true },
        { key: "projects", visible: true },
        { key: "tasks", visible: true },
        { key: "contracts", visible: true },
        { key: "certifications", visible: true },
        { key: "suppliers", visible: true },
        { key: "tools", visible: true },
      ],
    },
    {
      id: "resources",
      title: "Resources",
      items: [
        { key: "intranet", visible: true },
      ],
    },
    {
      id: "admin-section",
      title: "Administration",
      items: [
        { key: "sandbox", visible: true },
        { key: "admin", visible: true },
        { key: "widgets", visible: true },
        { key: "theme", visible: true },
        { key: "sidebar", visible: true },
      ],
    },
  ],
};
