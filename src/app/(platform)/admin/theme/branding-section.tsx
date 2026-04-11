"use client";

import { useState, useTransition } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Trash2, Upload, CheckCircle2, AlertCircle } from "lucide-react";
import {
  uploadBrandingImage,
  clearBrandingImage,
  setCompanyName,
} from "@/actions/branding";
import type { BrandingSettings } from "@/lib/branding";

interface Props {
  branding: BrandingSettings;
}

export function BrandingSection({ branding }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(branding.companyName || "");
  const [nameSaved, setNameSaved] = useState(false);

  const handleSaveName = () => {
    startTransition(async () => {
      await setCompanyName(name);
      setNameSaved(true);
      router.refresh();
      setTimeout(() => setNameSaved(false), 2500);
    });
  };

  const handleClear = (target: "companyLogoFileId" | "backgroundImageFileId") => {
    startTransition(async () => {
      await clearBrandingImage(target);
      router.refresh();
    });
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <p className="text-sm text-muted-foreground">
          Customize the company name, logo, and login background. Logos and
          backgrounds upload through the file storage layer with public
          visibility so they cache efficiently.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Company name */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Company name</label>
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameSaved(false);
              }}
              placeholder="OpsHub"
              className="flex-1 h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Button
              size="sm"
              onClick={handleSaveName}
              disabled={isPending || name === (branding.companyName || "")}
            >
              {nameSaved ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-1.5 text-emerald-500" />
                  Saved
                </>
              ) : (
                "Save"
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Shown in the sidebar and on the login screen. Leave blank to use
            the default &ldquo;OpsHub&rdquo;.
          </p>
        </div>

        {/* Company logo */}
        <BrandingImageUploader
          target="companyLogoFileId"
          label="Company logo"
          currentUrl={branding.companyLogoUrl}
          description="Replaces the OpsHub text in the sidebar. PNG, JPG, or SVG, recommended height around 32-48px. Max 5MB."
          aspectClass="h-12 w-auto"
          onClear={() => handleClear("companyLogoFileId")}
          isPending={isPending}
        />

        {/* Background image */}
        <BrandingImageUploader
          target="backgroundImageFileId"
          label="Login background image"
          currentUrl={branding.backgroundImageUrl}
          description="Shown on the login page as a full-screen background. Use a high-resolution image (1920×1080 or larger). Max 5MB."
          aspectClass="h-32 w-full object-cover rounded"
          onClear={() => handleClear("backgroundImageFileId")}
          isPending={isPending}
        />
      </CardContent>
    </Card>
  );
}

function BrandingImageUploader({
  target,
  label,
  description,
  currentUrl,
  aspectClass,
  onClear,
  isPending,
}: {
  target: "companyLogoFileId" | "backgroundImageFileId";
  label: string;
  description: string;
  currentUrl: string | null;
  aspectClass: string;
  onClear: () => void;
  isPending: boolean;
}) {
  const router = useRouter();
  const [state, action] = useFormState(uploadBrandingImage, null);
  const [localResult, setLocalResult] = useState<typeof state>(null);

  // Pick up form action results and refresh
  if (state && state !== localResult) {
    setLocalResult(state);
    if (state.success) {
      router.refresh();
    }
    setTimeout(() => setLocalResult(null), 4000);
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>

      {currentUrl ? (
        <div className="flex items-start gap-3 rounded border border-border p-3 bg-muted/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={currentUrl} alt={label} className={aspectClass} />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">Currently in use</p>
            <button
              type="button"
              onClick={onClear}
              disabled={isPending}
              className="mt-1 inline-flex items-center gap-1 text-xs text-destructive hover:underline"
            >
              <Trash2 className="h-3 w-3" /> Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded border border-dashed border-border p-4 text-xs text-muted-foreground flex items-center gap-2">
          <ImageIcon className="h-4 w-4" />
          Not set — using default
        </div>
      )}

      <form action={action} className="flex items-center gap-2 pt-1">
        <input type="hidden" name="target" value={target} />
        <input
          type="file"
          name="file"
          accept="image/*"
          required
          className="text-xs file:mr-2 file:rounded file:border file:border-border file:bg-muted file:px-2 file:py-1 file:text-xs"
        />
        <Button size="sm" type="submit" variant="outline" disabled={isPending}>
          <Upload className="h-3.5 w-3.5 mr-1.5" />
          {currentUrl ? "Replace" : "Upload"}
        </Button>
        {localResult && (
          <span
            className={`flex items-center gap-1 text-xs ${
              localResult.success ? "text-emerald-600" : "text-destructive"
            }`}
          >
            {localResult.success ? (
              <>
                <CheckCircle2 className="h-3 w-3" /> Uploaded
              </>
            ) : (
              <>
                <AlertCircle className="h-3 w-3" /> {localResult.error}
              </>
            )}
          </span>
        )}
      </form>

      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
