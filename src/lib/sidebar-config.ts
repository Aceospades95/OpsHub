// Re-export SYSTEM_MODULES from the canonical module registry so there's a
// single source of truth. Do not edit the list here — edit src/lib/modules.ts.
export { SYSTEM_MODULES } from "@/lib/modules";

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
        { key: "team", visible: true },
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
        { key: "emails", visible: true },
        { key: "files", visible: true },
        { key: "notifications", visible: true },
      ],
    },
  ],
};
