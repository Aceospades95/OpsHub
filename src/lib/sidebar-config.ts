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
      title: "Workspace",
      items: [
        { key: "dashboard", visible: true },
        { key: "tasks", visible: true },
        { key: "team", visible: true },
      ],
    },
    {
      id: "delivery",
      title: "Delivery",
      items: [
        { key: "clients", visible: true },
        { key: "projects", visible: true },
        { key: "quotes", visible: true },
        { key: "contracts", visible: true },
        { key: "certifications", visible: true },
      ],
    },
    {
      id: "resources",
      title: "Resources",
      items: [
        { key: "intranet", visible: true },
        { key: "tools", visible: true },
        { key: "suppliers", visible: true },
      ],
    },
    {
      id: "admin-section",
      title: "",
      items: [
        { key: "settings", visible: true },
      ],
    },
  ],
};
