"use client";

/**
 * IconPicker — a small popover-based picker for selecting a Lucide icon
 * by name. Used by the sandbox page editor and any other place that wants
 * "let the user pick an icon" without bundling all 1000+ Lucide icons.
 *
 * Stores the icon name as a string so it can be persisted in the database
 * without serializing component references. Renders via the `Icon`
 * component below which falls back to a default if the name is unknown
 * or null.
 */

import { useState, useRef, useEffect } from "react";
import {
  // ─── Curated icon set ─────────────────────────────────────
  // Common categories useful for custom pages: documents, people, places,
  // tools, communication, money, time, status. Add more here as needed —
  // each icon adds a few KB to the client bundle.
  FileText,
  File,
  FileSpreadsheet,
  FilePlus,
  BookOpen,
  Book,
  Bookmark,
  Folder,
  FolderOpen,
  Package,
  Box,
  Users,
  User,
  UserPlus,
  Building2,
  Building,
  Home,
  Globe,
  MapPin,
  Map,
  Briefcase,
  Wrench,
  Hammer,
  Settings,
  Cog,
  Mail,
  MessageCircle,
  Phone,
  Calendar,
  Clock,
  CalendarDays,
  DollarSign,
  CreditCard,
  Receipt,
  TrendingUp,
  BarChart3,
  PieChart,
  Activity,
  Zap,
  Star,
  Heart,
  Flag,
  Award,
  Trophy,
  Shield,
  Lock,
  Key,
  CheckSquare,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  HelpCircle,
  Lightbulb,
  Target,
  Compass,
  Layers,
  Grid3x3,
  List,
  LayoutDashboard,
  Database,
  Cloud,
  Server,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The full registry of pickable icons. Keys are the lucide component
 * names (PascalCase) so they round-trip cleanly through the database
 * and the rendering helper.
 */
export const PICKER_ICONS: Record<string, LucideIcon> = {
  FileText, File, FileSpreadsheet, FilePlus,
  BookOpen, Book, Bookmark,
  Folder, FolderOpen,
  Package, Box,
  Users, User, UserPlus,
  Building2, Building, Home,
  Globe, MapPin, Map,
  Briefcase,
  Wrench, Hammer, Settings, Cog,
  Mail, MessageCircle, Phone,
  Calendar, Clock, CalendarDays,
  DollarSign, CreditCard, Receipt,
  TrendingUp, BarChart3, PieChart, Activity, Zap,
  Star, Heart, Flag, Award, Trophy,
  Shield, Lock, Key,
  CheckSquare, CheckCircle2, AlertCircle, AlertTriangle, Info, HelpCircle,
  Lightbulb, Target, Compass,
  Layers, Grid3x3, List, LayoutDashboard,
  Database, Cloud, Server,
};

/**
 * Resolve an icon name to a component. Returns the fallback if the name
 * isn't in the registry — safe to call with user-supplied strings.
 */
export function resolveIcon(name: string | null | undefined, fallback: LucideIcon = FileText): LucideIcon {
  if (!name) return fallback;
  return PICKER_ICONS[name] || fallback;
}

/**
 * Render an icon by name. Useful in pages that just need to display a
 * persisted icon string from the database.
 */
export function Icon({
  name,
  fallback,
  className,
}: {
  name: string | null | undefined;
  fallback?: LucideIcon;
  className?: string;
}) {
  const IconComponent = resolveIcon(name, fallback);
  return <IconComponent className={className} />;
}

interface IconPickerProps {
  /** Hidden form field name — the picker writes the selected icon name here */
  name: string;
  /** Currently selected icon name */
  value: string | null | undefined;
  /** Optional label */
  label?: string;
}

/**
 * The picker itself. Renders a button showing the current icon, opens a
 * grid popover on click, lets the user select or clear. Persists the
 * value in a hidden input so it's submitted with whatever form wraps it.
 */
export function IconPicker({ name, value, label }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(value || null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const SelectedIcon = resolveIcon(selected);
  const iconNames = Object.keys(PICKER_ICONS).sort();

  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium">{label}</label>}
      <input type="hidden" name={name} value={selected || ""} />
      <div className="relative" ref={popoverRef}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2"
        >
          <SelectedIcon className="h-4 w-4" />
          {selected || "Choose icon"}
        </Button>

        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 w-72 rounded border border-border bg-card shadow-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold">Pick an icon</p>
              {selected && (
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setOpen(false);
                  }}
                  className="text-[10px] text-muted-foreground hover:text-destructive"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-8 gap-1 max-h-64 overflow-y-auto">
              {iconNames.map((iconName) => {
                const IconComponent = PICKER_ICONS[iconName];
                const isActive = selected === iconName;
                return (
                  <button
                    key={iconName}
                    type="button"
                    onClick={() => {
                      setSelected(iconName);
                      setOpen(false);
                    }}
                    title={iconName}
                    className={`flex items-center justify-center h-8 w-8 rounded transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <IconComponent className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
