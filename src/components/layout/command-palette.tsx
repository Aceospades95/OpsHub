"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  User,
  Building2,
  FolderKanban,
  Truck,
  FileText,
  ScrollText,
  Wrench,
  BookOpen,
} from "lucide-react";

import { quickSearch, type SearchHit } from "@/actions/search";

/**
 * Cmd-K-style command palette.
 *
 * Mounted once at the platform layout. Header search opens it via the
 * `openCommandPalette` event below; the keyboard shortcut (⌘K / Ctrl-K)
 * works from anywhere.
 *
 * Search runs as a debounced server action. Each entity type is its own
 * bucket (Employees, Clients, Projects, Suppliers, Contracts, Quotes,
 * Tools, Intranet), capped at 5 hits per bucket so the panel stays
 * scannable. Arrow keys move between hits, Enter opens the selected
 * one, Escape closes.
 */

const TYPE_META: Record<
  SearchHit["type"],
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  employee: { label: "Employees", icon: User },
  client: { label: "Clients", icon: Building2 },
  project: { label: "Projects", icon: FolderKanban },
  supplier: { label: "Suppliers", icon: Truck },
  contract: { label: "Contracts", icon: FileText },
  quote: { label: "Quotes", icon: ScrollText },
  tool: { label: "Tools", icon: Wrench },
  intranet: { label: "Intranet", icon: BookOpen },
};

const TYPE_ORDER: SearchHit["type"][] = [
  "project",
  "client",
  "employee",
  "quote",
  "contract",
  "supplier",
  "tool",
  "intranet",
];

/**
 * Module-scoped event bus the header trigger uses to open the palette
 * without prop-drilling. The platform layout mounts the palette; the
 * header is unaware of it.
 */
const OPEN_EVENT = "opshub:open-command-palette";

export function openCommandPalette(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Listen for the global "open" event + ⌘K / Ctrl-K shortcut.
  // Round-4 QA: the previous wiring re-bound on every `open` change,
  // and the keyboard handler closed over a stale `open` value when
  // React batched a state update. The keydown was firing but the
  // toggle reverted before the next render. Mount-once handler with
  // a ref for the open-state read fixes both: listener attaches at
  // mount, never leaks across rebinds, and reads `open` fresh on
  // every key event.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (openRef.current && e.key === "Escape") {
        setOpen(false);
      }
    };
    const opener = () => setOpen(true);
    window.addEventListener("keydown", handler);
    window.addEventListener(OPEN_EVENT, opener);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener(OPEN_EVENT, opener);
    };
  }, []);

  // Reset state on close so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setActiveIndex(0);
      return;
    }
    // Focus the input next tick so the panel has mounted.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Debounced search. 150ms is short enough to feel live but long
  // enough that holding down a key doesn't issue 5 server actions per
  // second. Empty query clears immediately without a round-trip.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setHits([]);
      setTruncated(false);
      setActiveIndex(0);
      return;
    }
    const timer = setTimeout(() => {
      startTransition(async () => {
        try {
          const result = await quickSearch(trimmed);
          setHits(result.hits);
          setTruncated(result.truncated);
          setActiveIndex(0);
        } catch {
          setHits([]);
          setTruncated(false);
        }
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [query, open]);

  // Group hits by type for section headings, in a stable order so
  // moving between buckets is predictable.
  const grouped = useMemo(() => {
    const buckets = new Map<SearchHit["type"], SearchHit[]>();
    for (const h of hits) {
      const arr = buckets.get(h.type) ?? [];
      arr.push(h);
      buckets.set(h.type, arr);
    }
    return TYPE_ORDER.filter((t) => buckets.has(t)).map((t) => ({
      type: t,
      items: buckets.get(t)!,
    }));
  }, [hits]);

  /** Flat ordered hit list mirroring the rendered order — used by the
   *  arrow-key navigation so activeIndex maps to a single concrete hit. */
  const flat = useMemo(
    () => grouped.flatMap((g) => g.items),
    [grouped]
  );

  const handleSelect = useCallback(
    (hit: SearchHit) => {
      setOpen(false);
      router.push(hit.href);
    },
    [router]
  );

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[activeIndex];
      if (hit) handleSelect(hit);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-24"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search projects, employees, clients, quotes…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            role="combobox"
            aria-controls="command-palette-results"
            aria-expanded="true"
            aria-autocomplete="list"
          />
          <span className="hidden sm:inline-block rounded border border-border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            Esc
          </span>
        </div>

        <div
          id="command-palette-results"
          className="max-h-96 overflow-y-auto"
          role="listbox"
        >
          {query.trim().length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              Type to search projects, employees, clients, quotes, contracts, suppliers, tools, and intranet pages.
            </p>
          ) : pending && hits.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">Searching…</p>
          ) : flat.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              No matches for &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <>
              {grouped.map((group) => {
                const Icon = TYPE_META[group.type].icon;
                const label = TYPE_META[group.type].label;
                return (
                  <div key={group.type}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                      {label}
                    </div>
                    {group.items.map((hit) => {
                      const indexInFlat = flat.indexOf(hit);
                      const isActive = indexInFlat === activeIndex;
                      return (
                        <button
                          key={hit.id}
                          type="button"
                          onMouseEnter={() => setActiveIndex(indexInFlat)}
                          onClick={() => handleSelect(hit)}
                          className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                            isActive ? "bg-primary/10" : "hover:bg-muted"
                          }`}
                          role="option"
                          aria-selected={isActive}
                        >
                          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{hit.label}</p>
                            {hit.sublabel && (
                              <p className="truncate text-xs text-muted-foreground">
                                {hit.sublabel}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {truncated && (
                <p className="px-3 py-2 text-[10px] text-muted-foreground text-center border-t border-border">
                  Some buckets are showing top {5} matches — refine the query for the rest.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
