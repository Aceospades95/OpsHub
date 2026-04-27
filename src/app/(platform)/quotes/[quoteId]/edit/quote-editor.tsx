"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, ArrowUp, ArrowDown, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { computeQuoteTotals, formatCurrency } from "@/lib/quotes/totals";
import { updateQuote } from "@/actions/quotes";

type DiscountType = "NONE" | "PERCENT" | "FIXED";
type RecurringInterval = "MONTHLY" | "QUARTERLY" | "ANNUALLY";

interface LineItem {
  /** Stable id for keying / re-ordering during this edit session. Not persisted. */
  clientId: string;
  position: number;
  groupLabel: string | null;
  isOptional: boolean;
  isSelected: boolean;
  catalogItemId: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  discountType: DiscountType;
  discountValue: number;
  isRecurring: boolean;
  recurringInterval: RecurringInterval | null;
}

interface InitialQuote {
  id: string;
  quoteNumber: string;
  clientId: string;
  projectId: string | null;
  title: string;
  introText: string | null;
  termsText: string | null;
  currency: string;
  discountType: DiscountType;
  discountValue: number;
  taxRate: number | null;
  validUntil: string | null;
  assignedToId: string | null;
  internalNotes: string | null;
  status: string;
  lineItems: LineItem[];
}

interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
  defaultUnitPrice: number;
  defaultUnit: string | null;
  category: string | null;
  isRecurring: boolean;
}

interface Props {
  initial: InitialQuote;
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientId: string }[];
  users: { id: string; name: string }[];
  catalog: CatalogItem[];
}

let nextLineId = 0;
function newLineId() {
  nextLineId += 1;
  return `cli-${nextLineId}-${Date.now()}`;
}

function emptyLine(position: number): LineItem {
  return {
    clientId: newLineId(),
    position,
    groupLabel: null,
    isOptional: false,
    isSelected: true,
    catalogItemId: null,
    name: "",
    description: null,
    quantity: 1,
    unit: null,
    unitPrice: 0,
    discountType: "NONE",
    discountValue: 0,
    isRecurring: false,
    recurringInterval: null,
  };
}

export function QuoteEditor({ initial, clients, projects, users, catalog }: Props) {
  const router = useRouter();

  const [title, setTitle] = useState(initial.title);
  const [clientId, setClientId] = useState(initial.clientId);
  const [projectId, setProjectId] = useState<string>(initial.projectId ?? "");
  const [validUntil, setValidUntil] = useState<string>(initial.validUntil ?? "");
  const [currency, setCurrency] = useState(initial.currency);
  const [introText, setIntroText] = useState<string>(initial.introText ?? "");
  const [termsText, setTermsText] = useState<string>(initial.termsText ?? "");
  const [internalNotes, setInternalNotes] = useState<string>(initial.internalNotes ?? "");
  const [discountType, setDiscountType] = useState<DiscountType>(initial.discountType);
  const [discountValue, setDiscountValue] = useState<number>(initial.discountValue);
  const [taxRate, setTaxRate] = useState<string>(
    initial.taxRate == null ? "" : String(initial.taxRate)
  );
  const [assignedToId, setAssignedToId] = useState<string>(initial.assignedToId ?? "");
  const [items, setItems] = useState<LineItem[]>(
    initial.lineItems.length > 0 ? initial.lineItems : [emptyLine(0)]
  );

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const filteredProjects = useMemo(
    () => projects.filter((p) => p.clientId === clientId),
    [projects, clientId]
  );

  // Live totals — pure function so the preview updates as the user types.
  const totals = useMemo(
    () =>
      computeQuoteTotals({
        lineItems: items.map((it) => ({
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          discountType: it.discountType,
          discountValue: it.discountValue,
          isOptional: it.isOptional,
          isSelected: it.isSelected,
        })),
        discountType,
        discountValue,
        taxRate: taxRate.trim() === "" ? null : Number(taxRate),
      }),
    [items, discountType, discountValue, taxRate]
  );

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function addItem(groupLabel: string | null = null) {
    setItems((prev) => [
      ...prev,
      { ...emptyLine(prev.length), groupLabel },
    ]);
  }

  function removeItem(index: number) {
    setItems((prev) =>
      prev.filter((_, i) => i !== index).map((it, i) => ({ ...it, position: i }))
    );
  }

  function moveItem(index: number, dir: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((it, i) => ({ ...it, position: i }));
    });
  }

  function pickFromCatalog(index: number, catalogItemId: string) {
    if (!catalogItemId) {
      updateItem(index, { catalogItemId: null });
      return;
    }
    const c = catalog.find((x) => x.id === catalogItemId);
    if (!c) return;
    updateItem(index, {
      catalogItemId: c.id,
      name: c.name,
      description: c.description,
      unit: c.defaultUnit,
      unitPrice: c.defaultUnitPrice,
      isRecurring: c.isRecurring,
    });
  }

  function handleSave() {
    setError(null);
    const taxRateNum = taxRate.trim() === "" ? null : Number(taxRate);
    if (taxRateNum != null && !Number.isFinite(taxRateNum)) {
      setError("Tax rate must be a number or blank");
      return;
    }
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    for (const it of items) {
      if (!it.name.trim()) {
        setError("Every line item needs a name");
        return;
      }
    }

    startTransition(async () => {
      const res = await updateQuote({
        id: initial.id,
        clientId,
        projectId: projectId || null,
        title: title.trim(),
        introText: introText.trim() || null,
        termsText: termsText.trim() || null,
        currency: currency || "USD",
        discountType,
        discountValue,
        taxRate: taxRateNum,
        validUntil: validUntil || null,
        assignedToId: assignedToId || null,
        internalNotes: internalNotes.trim() || null,
        lineItems: items.map((it, i) => ({
          clientId: it.clientId,
          position: i,
          groupLabel: it.groupLabel,
          isOptional: it.isOptional,
          isSelected: it.isSelected,
          catalogItemId: it.catalogItemId,
          name: it.name.trim(),
          description: it.description,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          discountType: it.discountType,
          discountValue: it.discountValue,
          isRecurring: it.isRecurring,
          recurringInterval: it.recurringInterval,
        })),
      });
      if ("error" in res) {
        setError(res.error ?? "Unknown error");
        return;
      }
      setSavedAt(new Date());
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">
            {initial.quoteNumber}
          </p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-2xl font-bold bg-transparent border-0 outline-none focus:ring-0 p-0 w-full"
            placeholder="Untitled Quote"
          />
        </div>
        <div className="flex items-center gap-2">
          {savedAt && (
            <span className="text-xs text-muted-foreground">
              Saved {savedAt.toLocaleTimeString()}
            </span>
          )}
          <Link href={`/quotes/${initial.id}`}>
            <Button variant="outline">
              <X className="h-4 w-4 mr-2" />
              Close
            </Button>
          </Link>
          <Button onClick={handleSave} disabled={pending}>
            <Save className="h-4 w-4 mr-2" />
            {pending ? "Saving…" : "Save Draft"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT — form */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Header</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="Client"
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value);
                    setProjectId(""); // reset project when client changes
                  }}
                  options={clients.map((c) => ({ label: c.name, value: c.id }))}
                />
                <Select
                  label="Project (optional)"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  placeholder={
                    filteredProjects.length === 0
                      ? "No active projects for this client"
                      : "No project"
                  }
                  options={filteredProjects.map((p) => ({
                    label: p.name,
                    value: p.id,
                  }))}
                />
                <Input
                  label="Valid until"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
                <Input
                  label="Currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                />
                <Select
                  label="Owner"
                  value={assignedToId}
                  onChange={(e) => setAssignedToId(e.target.value)}
                  placeholder="Unassigned"
                  options={users.map((u) => ({ label: u.name, value: u.id }))}
                />
              </div>
              <Textarea
                label="Intro text"
                value={introText}
                onChange={(e) => setIntroText(e.target.value)}
                placeholder="Short message rendered above the line items on the public view."
                rows={3}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Line items</CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addItem()}
                    type="button"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add row
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addItem("Optional Add-ons")}
                    type="button"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add group
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((it, i) => (
                <LineItemRow
                  key={it.clientId}
                  item={it}
                  index={i}
                  catalog={catalog}
                  currency={currency}
                  rowSubtotal={totals.lineSubtotals[i]?.subtotal ?? 0}
                  onUpdate={(patch) => updateItem(i, patch)}
                  onRemove={() => removeItem(i)}
                  onMoveUp={i > 0 ? () => moveItem(i, -1) : undefined}
                  onMoveDown={
                    i < items.length - 1 ? () => moveItem(i, 1) : undefined
                  }
                  onPickCatalog={(id) => pickFromCatalog(i, id)}
                />
              ))}
              {items.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No line items. Click <strong>Add row</strong>.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Adjustments</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Select
                label="Quote discount"
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                options={[
                  { label: "None", value: "NONE" },
                  { label: "Percent", value: "PERCENT" },
                  { label: "Fixed", value: "FIXED" },
                ]}
              />
              <Input
                label={
                  discountType === "PERCENT" ? "Discount %" : "Discount amount"
                }
                type="number"
                min="0"
                step="0.01"
                value={discountValue}
                onChange={(e) => setDiscountValue(Number(e.target.value) || 0)}
                disabled={discountType === "NONE"}
              />
              <Input
                label="Tax rate (% — blank for tax-exempt)"
                type="number"
                min="0"
                step="0.01"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Terms & notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                label="Terms"
                value={termsText}
                onChange={(e) => setTermsText(e.target.value)}
                placeholder="Footer / T&Cs rendered below the totals on the public view."
                rows={4}
              />
              <Textarea
                label="Internal notes (never shown to client)"
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                rows={3}
              />
            </CardContent>
          </Card>
        </div>

        {/* RIGHT — live preview */}
        <div className="space-y-4 lg:sticky lg:top-4 self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <p className="font-mono text-xs text-muted-foreground">
                {initial.quoteNumber}
              </p>
              <p className="font-semibold text-base">{title || "Untitled"}</p>
              {introText && (
                <p className="text-muted-foreground whitespace-pre-wrap text-xs">
                  {introText}
                </p>
              )}

              {items.length > 0 && (
                <div className="space-y-2 border-t border-border pt-3">
                  {items.map((it, i) => (
                    <div
                      key={it.clientId}
                      className={`flex items-start justify-between gap-2 ${
                        it.isOptional && !it.isSelected
                          ? "opacity-50 line-through"
                          : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-xs">
                          {it.name || "(unnamed item)"}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {it.groupLabel && (
                            <Badge variant="outline" className="text-[10px]">
                              {it.groupLabel}
                            </Badge>
                          )}
                          {it.isOptional && (
                            <Badge variant="outline" className="text-[10px]">
                              Optional
                            </Badge>
                          )}
                          {it.isRecurring && (
                            <Badge variant="secondary" className="text-[10px]">
                              {(it.recurringInterval ?? "RECURRING").toLowerCase()}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="tabular-nums text-xs">
                        {formatCurrency(
                          totals.lineSubtotals[i]?.subtotal ?? 0,
                          currency
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-border pt-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs">Subtotal</span>
                  <span className="tabular-nums text-xs">
                    {formatCurrency(totals.subtotal, currency)}
                  </span>
                </div>
                {totals.discountAmount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Discount</span>
                    <span className="tabular-nums text-xs">
                      −{formatCurrency(totals.discountAmount, currency)}
                    </span>
                  </div>
                )}
                {totals.taxAmount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">
                      Tax ({taxRate}%)
                    </span>
                    <span className="tabular-nums text-xs">
                      {formatCurrency(totals.taxAmount, currency)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between font-semibold border-t border-border pt-1.5">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {formatCurrency(totals.total, currency)}
                  </span>
                </div>
              </div>

              {termsText && (
                <p className="border-t border-border pt-3 text-[10px] text-muted-foreground whitespace-pre-wrap">
                  {termsText}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

interface LineRowProps {
  item: LineItem;
  index: number;
  catalog: CatalogItem[];
  currency: string;
  rowSubtotal: number;
  onUpdate: (patch: Partial<LineItem>) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onPickCatalog: (id: string) => void;
}

function LineItemRow({
  item,
  catalog,
  currency,
  rowSubtotal,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onPickCatalog,
}: LineRowProps) {
  const [showDescription, setShowDescription] = useState(
    !!item.description && item.description.length > 0
  );

  return (
    <div className="rounded border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex flex-col gap-1 pt-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!onMoveUp}
            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Move up"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!onMoveDown}
            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Move down"
          >
            <ArrowDown className="h-3 w-3" />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-12 gap-2">
          <div className="col-span-12 sm:col-span-5">
            <Input
              label="Name"
              value={item.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              list={`catalog-${item.clientId}`}
              placeholder="Service or product name"
            />
            <datalist id={`catalog-${item.clientId}`}>
              {catalog.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            {catalog.length > 0 && (
              <button
                type="button"
                className="text-[11px] text-primary hover:underline mt-1"
                onClick={() => {
                  const match = catalog.find(
                    (c) => c.name.toLowerCase() === item.name.trim().toLowerCase()
                  );
                  if (match) onPickCatalog(match.id);
                }}
              >
                Use catalog defaults
              </button>
            )}
          </div>
          <div className="col-span-4 sm:col-span-2">
            <Input
              label="Qty"
              type="number"
              min="0"
              step="0.01"
              value={item.quantity}
              onChange={(e) => onUpdate({ quantity: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="col-span-4 sm:col-span-1">
            <Input
              label="Unit"
              value={item.unit ?? ""}
              onChange={(e) => onUpdate({ unit: e.target.value || null })}
              placeholder="ea"
            />
          </div>
          <div className="col-span-4 sm:col-span-2">
            <Input
              label="Price"
              type="number"
              min="0"
              step="0.01"
              value={item.unitPrice}
              onChange={(e) =>
                onUpdate({ unitPrice: Number(e.target.value) || 0 })
              }
            />
          </div>
          <div className="col-span-12 sm:col-span-2">
            <p className="text-xs font-medium text-foreground mb-1">Subtotal</p>
            <p className="tabular-nums text-sm h-10 flex items-center">
              {formatCurrency(rowSubtotal, currency)}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="p-2 text-muted-foreground hover:text-destructive"
          aria-label="Remove line"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => setShowDescription((v) => !v)}
          className="text-primary hover:underline"
        >
          {showDescription ? "Hide" : "Add"} description
        </button>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={item.isOptional}
            onChange={(e) => onUpdate({ isOptional: e.target.checked })}
          />
          Optional
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={item.isRecurring}
            onChange={(e) =>
              onUpdate({
                isRecurring: e.target.checked,
                recurringInterval: e.target.checked
                  ? item.recurringInterval ?? "MONTHLY"
                  : null,
              })
            }
          />
          Recurring
        </label>
        {item.isRecurring && (
          <select
            value={item.recurringInterval ?? "MONTHLY"}
            onChange={(e) =>
              onUpdate({
                recurringInterval: e.target.value as RecurringInterval,
              })
            }
            className="h-7 rounded border border-input bg-background px-2 text-xs"
          >
            <option value="MONTHLY">Monthly</option>
            <option value="QUARTERLY">Quarterly</option>
            <option value="ANNUALLY">Annually</option>
          </select>
        )}
        <Input
          aria-label="Group label"
          placeholder="Group label (optional)"
          value={item.groupLabel ?? ""}
          onChange={(e) => onUpdate({ groupLabel: e.target.value || null })}
          className="h-7 text-xs flex-1 min-w-[160px]"
        />
        <select
          value={item.discountType}
          onChange={(e) =>
            onUpdate({ discountType: e.target.value as DiscountType })
          }
          className="h-7 rounded border border-input bg-background px-2 text-xs"
        >
          <option value="NONE">No row discount</option>
          <option value="PERCENT">Row % off</option>
          <option value="FIXED">Row $ off</option>
        </select>
        {item.discountType !== "NONE" && (
          <Input
            type="number"
            min="0"
            step="0.01"
            value={item.discountValue}
            onChange={(e) =>
              onUpdate({ discountValue: Number(e.target.value) || 0 })
            }
            className="h-7 w-20 text-xs"
            aria-label="Row discount value"
          />
        )}
      </div>

      {showDescription && (
        <Textarea
          aria-label="Description"
          value={item.description ?? ""}
          onChange={(e) => onUpdate({ description: e.target.value || null })}
          placeholder="Description shown to the client"
          rows={2}
        />
      )}
    </div>
  );
}
