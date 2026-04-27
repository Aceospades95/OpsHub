"use client";

import { useRef, useState, useTransition } from "react";
import { PenTool } from "lucide-react";

import { submitWorkflowPortalSignature } from "@/actions/workflow-portal";
import type { PendingItem } from "./portal-client";

interface Props {
  token: string;
  item: PendingItem;
  onComplete: () => void;
  onCancel: () => void;
}

/**
 * Signature card — renders the agreement text the workflow author
 * configured plus a typed-name field and an optional drawn signature
 * canvas. Same canvas pattern the public quote page uses, kept inline
 * here rather than extracted because the styling differs slightly
 * (portal greys vs quote neutrals) and the component is small.
 */
export function SignatureCard({ token, item, onComplete, onCancel }: Props) {
  const documentText = (item.config.documentText as string) ?? "";
  const required = (item.config.required as boolean) ?? true;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signedName, setSignedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setupCtx(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#1a1a1a";
    }
  }
  function pt(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    setupCtx(e.currentTarget);
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = pt(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = pt(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    setDrawing(false);
    setSignatureData(e.currentTarget.toDataURL("image/png"));
  }
  function clearCanvas() {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setSignatureData(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!signedName.trim()) {
      setError("Type your name to sign");
      return;
    }
    if (required && !agreed) {
      setError("Confirm you've read the agreement");
      return;
    }
    startTransition(async () => {
      const res = await submitWorkflowPortalSignature({
        token,
        instanceStepId: item.instanceStepId,
        signedName: signedName.trim(),
        signatureData,
      });
      if ("error" in res) {
        setError(res.error ?? "Could not save signature");
        return;
      }
      onComplete();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {documentText && (
        <div className="rounded border border-neutral-200 bg-white p-3 max-h-60 overflow-y-auto text-sm whitespace-pre-wrap text-neutral-800">
          {documentText}
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">
          Type your full legal name
        </label>
        <input
          type="text"
          value={signedName}
          onChange={(e) => setSignedName(e.target.value)}
          autoComplete="name"
          required
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">
          Drawn signature (optional)
        </label>
        <div className="rounded border border-neutral-300 bg-white">
          <canvas
            ref={canvasRef}
            width={520}
            height={120}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="block w-full h-[120px] touch-none"
          />
        </div>
        <button
          type="button"
          onClick={clearCanvas}
          className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline mt-1"
        >
          Clear signature
        </button>
      </div>
      {required && (
        <label className="flex items-start gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-neutral-300"
          />
          I have read the agreement above and accept its terms.
        </label>
      )}
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="px-4 py-2 rounded-md border border-neutral-300 text-sm hover:bg-neutral-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-60 inline-flex items-center"
        >
          <PenTool className="h-3 w-3 mr-1.5" />
          {pending ? "Signing…" : "Sign and submit"}
        </button>
      </div>
    </form>
  );
}
