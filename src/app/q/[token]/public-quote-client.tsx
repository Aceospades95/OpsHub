"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { computeQuoteTotals, formatCurrency } from "@/lib/quotes/totals";
import { acceptQuotePublic, rejectQuotePublic } from "@/actions/quotes";

type DiscountType = "NONE" | "PERCENT" | "FIXED";

interface LineItem {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  isOptional: boolean;
  isSelected: boolean;
  isRecurring: boolean;
  recurringInterval: "MONTHLY" | "QUARTERLY" | "ANNUALLY" | null;
  discountType: DiscountType;
  discountValue: number;
}

interface Group {
  label: string | null;
  items: LineItem[];
}

interface QuoteData {
  id: string;
  quoteNumber: string;
  title: string;
  introText: string | null;
  termsText: string | null;
  currency: string;
  status: string;
  validUntil: string | null;
  taxRate: number | null;
  discountType: DiscountType;
  discountValue: number;
  acceptedAt: string | null;
  acceptedSignatureName: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  clientName: string;
}

interface InitialTotals {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
}

interface Props {
  quote: QuoteData;
  groups: Group[];
  token: string;
  initialTotals: InitialTotals;
  expired: boolean;
}

export function PublicQuoteClient({ quote, groups, token, initialTotals, expired }: Props) {
  const router = useRouter();
  const isFinalized = quote.status === "ACCEPTED" || quote.status === "REJECTED";

  // Track which optional rows are currently selected. Non-optional rows
  // are always selected and don't appear in this map.
  const initialSelected = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const g of groups) {
      for (const li of g.items) {
        if (li.isOptional) m.set(li.id, li.isSelected);
      }
    }
    return m;
  }, [groups]);
  const [selected, setSelected] = useState<Map<string, boolean>>(initialSelected);

  const totals = useMemo(() => {
    if (isFinalized) return initialTotals;
    const flat = groups.flatMap((g) =>
      g.items.map((li) => ({
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        discountType: li.discountType,
        discountValue: li.discountValue,
        isOptional: li.isOptional,
        isSelected: li.isOptional ? selected.get(li.id) ?? false : true,
      }))
    );
    return computeQuoteTotals({
      lineItems: flat,
      discountType: quote.discountType,
      discountValue: quote.discountValue,
      taxRate: quote.taxRate,
    });
  }, [groups, selected, quote, isFinalized, initialTotals]);

  function toggleOptional(id: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      next.set(id, !next.get(id));
      return next;
    });
  }

  return (
    <article className="bg-white rounded-lg shadow-sm border border-neutral-200 overflow-hidden">
      {/* Status banner */}
      <StatusBanner quote={quote} expired={expired} />

      <div className="p-8 sm:p-10">
        <p className="font-mono text-xs text-neutral-500 mb-1">
          {quote.quoteNumber}
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900">
          {quote.title}
        </h1>
        <p className="text-sm text-neutral-600 mt-1">
          Prepared for <strong>{quote.clientName}</strong>
        </p>
        {quote.validUntil && (
          <p className="text-xs text-neutral-500 mt-1">
            Valid until {new Date(quote.validUntil).toLocaleDateString()}
          </p>
        )}

        {quote.introText && (
          <p className="text-sm text-neutral-700 whitespace-pre-wrap mt-6 leading-relaxed">
            {quote.introText}
          </p>
        )}

        {/* Line items grouped by group_label */}
        <section className="mt-8 space-y-6">
          {groups.map((g, idx) => (
            <div key={idx}>
              {g.label && (
                <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-2 font-semibold">
                  {g.label}
                </h3>
              )}
              <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
                {g.items.map((li) => (
                  <PublicLineRow
                    key={li.id}
                    item={li}
                    currency={quote.currency}
                    selected={
                      li.isOptional ? selected.get(li.id) ?? false : true
                    }
                    onToggle={() => toggleOptional(li.id)}
                    isFinalized={isFinalized}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* Totals */}
        <section className="mt-8 ml-auto max-w-sm">
          <dl className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-neutral-600">Subtotal</dt>
              <dd className="tabular-nums">
                {formatCurrency(totals.subtotal, quote.currency)}
              </dd>
            </div>
            {totals.discountAmount > 0 && (
              <div className="flex items-center justify-between">
                <dt className="text-neutral-600">Discount</dt>
                <dd className="tabular-nums">
                  −{formatCurrency(totals.discountAmount, quote.currency)}
                </dd>
              </div>
            )}
            {quote.taxRate != null && (
              <div className="flex items-center justify-between">
                <dt className="text-neutral-600">Tax ({quote.taxRate}%)</dt>
                <dd className="tabular-nums">
                  {formatCurrency(totals.taxAmount, quote.currency)}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-neutral-200 pt-2 text-lg font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">
                {formatCurrency(totals.total, quote.currency)}
              </dd>
            </div>
          </dl>
        </section>

        {/* Action panel — hidden when already finalized or expired */}
        {!isFinalized && !expired && (
          <ActionPanel
            token={token}
            optionalSelections={selected}
            onChange={() => router.refresh()}
          />
        )}

        {quote.termsText && (
          <section className="mt-10 pt-6 border-t border-neutral-200">
            <h4 className="text-xs uppercase tracking-wide text-neutral-500 mb-2 font-semibold">
              Terms
            </h4>
            <p className="text-xs text-neutral-600 whitespace-pre-wrap leading-relaxed">
              {quote.termsText}
            </p>
          </section>
        )}
      </div>
    </article>
  );
}

function StatusBanner({
  quote,
  expired,
}: {
  quote: QuoteData;
  expired: boolean;
}) {
  if (quote.status === "ACCEPTED") {
    return (
      <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-3 text-sm text-emerald-800">
        Accepted{quote.acceptedAt
          ? ` on ${new Date(quote.acceptedAt).toLocaleDateString()}`
          : ""}
        {quote.acceptedSignatureName ? ` by ${quote.acceptedSignatureName}` : ""}.
      </div>
    );
  }
  if (quote.status === "REJECTED") {
    return (
      <div className="bg-rose-50 border-b border-rose-200 px-6 py-3 text-sm text-rose-800">
        Rejected{quote.rejectedAt
          ? ` on ${new Date(quote.rejectedAt).toLocaleDateString()}`
          : ""}
        {quote.rejectionReason ? `: ${quote.rejectionReason}` : "."}
      </div>
    );
  }
  if (expired) {
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-sm text-amber-800">
        This quote has expired. Contact the sender for a refreshed version.
      </div>
    );
  }
  return null;
}

function PublicLineRow({
  item,
  currency,
  selected,
  onToggle,
  isFinalized,
}: {
  item: LineItem;
  currency: string;
  selected: boolean;
  onToggle: () => void;
  isFinalized: boolean;
}) {
  const showCheckbox = item.isOptional && !isFinalized;
  const isDimmed = item.isOptional && !selected;
  // Compute the row's contribution at full pre-toggle qty so the recipient
  // sees what each item adds when they tick the box.
  const rawSubtotal = item.quantity * item.unitPrice;

  return (
    <li
      className={`flex items-start justify-between gap-4 py-3 ${
        isDimmed ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-start gap-3 min-w-0">
        {showCheckbox ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="mt-1 h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
            aria-label={`Include ${item.name}`}
          />
        ) : (
          <span className="mt-1 inline-block h-4 w-4" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-neutral-900">{item.name}</p>
          {item.description && (
            <p className="text-xs text-neutral-600 whitespace-pre-wrap mt-0.5">
              {item.description}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-1 text-xs text-neutral-500">
            <span>
              {item.quantity}
              {item.unit ? ` ${item.unit}` : ""} ×{" "}
              {formatCurrency(item.unitPrice, currency)}
            </span>
            {item.isOptional && <span className="font-medium">Optional</span>}
            {item.isRecurring && (
              <span>
                {(item.recurringInterval ?? "RECURRING").toLowerCase()}
              </span>
            )}
          </div>
        </div>
      </div>
      <p className="text-sm tabular-nums text-neutral-900 shrink-0">
        {formatCurrency(rawSubtotal, currency)}
      </p>
    </li>
  );
}

function ActionPanel({
  token,
  optionalSelections,
  onChange,
}: {
  token: string;
  optionalSelections: Map<string, boolean>;
  onChange: () => void;
}) {
  const [mode, setMode] = useState<"none" | "accept" | "reject">("none");

  if (mode === "accept") {
    return (
      <AcceptForm
        token={token}
        optionalSelections={optionalSelections}
        onCancel={() => setMode("none")}
        onSuccess={onChange}
      />
    );
  }
  if (mode === "reject") {
    return (
      <RejectForm
        token={token}
        onCancel={() => setMode("none")}
        onSuccess={onChange}
      />
    );
  }

  return (
    <div className="mt-10 pt-6 border-t border-neutral-200 flex flex-col sm:flex-row gap-3 sm:justify-end">
      <button
        type="button"
        onClick={() => setMode("reject")}
        className="px-5 py-2.5 rounded-md border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
      >
        Reject
      </button>
      <button
        type="button"
        onClick={() => setMode("accept")}
        className="px-5 py-2.5 rounded-md bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-800"
      >
        Accept &amp; sign
      </button>
    </div>
  );
}

function AcceptForm({
  token,
  optionalSelections,
  onCancel,
  onSuccess,
}: {
  token: string;
  optionalSelections: Map<string, boolean>;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Type your name to sign");
      return;
    }
    if (!agreed) {
      setError("Confirm you've reviewed the quote and terms");
      return;
    }

    const selectedIds = Array.from(optionalSelections.entries())
      .filter(([, on]) => on)
      .map(([id]) => id);

    startTransition(async () => {
      const res = await acceptQuotePublic({
        token,
        signatureName: name.trim(),
        signatureData,
        selectedOptionalItemIds: selectedIds,
      });
      if ("error" in res) {
        setError(res.error ?? "Could not accept the quote");
        return;
      }
      onSuccess();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-10 pt-6 border-t border-neutral-200 space-y-4"
    >
      <h3 className="text-base font-semibold text-neutral-900">
        Accept &amp; sign
      </h3>
      <p className="text-xs text-neutral-600">
        By signing below you accept the line items and totals shown above.
      </p>

      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">
          Full legal name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          autoComplete="name"
          required
        />
      </div>

      <SignaturePad value={signatureData} onChange={setSignatureData} />

      <label className="flex items-start gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
        />
        <span>
          I&apos;ve reviewed the line items and accept the terms shown on this
          page.
        </span>
      </label>

      {error && <p className="text-sm text-rose-700">{error}</p>}

      <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="px-5 py-2.5 rounded-md border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="px-5 py-2.5 rounded-md bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? "Submitting…" : "Sign &amp; accept"}
        </button>
      </div>
    </form>
  );
}

function RejectForm({
  token,
  onCancel,
  onSuccess,
}: {
  token: string;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await rejectQuotePublic({
        token,
        reason: reason.trim() || null,
      });
      if ("error" in res) {
        setError(res.error ?? "Could not reject the quote");
        return;
      }
      onSuccess();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-10 pt-6 border-t border-neutral-200 space-y-4"
    >
      <h3 className="text-base font-semibold text-neutral-900">Reject quote</h3>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">
          Reason (optional)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          placeholder="Helpful for the sender to understand what didn't fit"
        />
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="px-5 py-2.5 rounded-md border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="px-5 py-2.5 rounded-md bg-rose-600 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
        >
          {pending ? "Submitting…" : "Reject"}
        </button>
      </div>
    </form>
  );
}

/**
 * Minimal pointer-driven signature canvas. The captured drawing is
 * exported as a base64 PNG and round-tripped via a hidden state. The
 * server stores it as the `acceptedSignatureData` blob; we never load
 * heavy canvas libraries here so the public page stays light.
 */
function SignaturePad({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (data: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);

  function setupCtx(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#1a1a1a";
    }
  }

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    setupCtx(e.currentTarget);
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    setDrawing(false);
    onChange(e.currentTarget.toDataURL("image/png"));
  }
  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange(null);
  }

  return (
    <div>
      <label className="block text-xs font-medium text-neutral-700 mb-1">
        Signature (optional — typed name above is the binding signature)
      </label>
      <div className="relative rounded border border-neutral-300 bg-neutral-50">
        <canvas
          ref={canvasRef}
          width={600}
          height={140}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="block w-full h-[140px] touch-none"
        />
        {value && (
          <span className="absolute top-1 right-1 text-[10px] text-neutral-400">
            captured
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        className="mt-1 text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
      >
        Clear signature
      </button>
    </div>
  );
}
