import { notFound } from "next/navigation";

import { getPortalSubject, buildPortalView } from "@/lib/workflows/portal";
import { getBranding } from "@/lib/branding";

import { PortalClient } from "./portal-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function PortalPage({ params }: Props) {
  const { token } = await params;

  const subject = await getPortalSubject(token);
  if (!subject) notFound();

  const [view, branding] = await Promise.all([
    buildPortalView(subject),
    getBranding(),
  ]);

  // Convert Date instances to strings at the server/client boundary.
  const serialized = {
    subject: view.subject,
    pending: view.pending.map((p) => ({
      ...p,
      scheduledFor: p.scheduledFor ? p.scheduledFor.toISOString() : null,
    })),
    completed: view.completed.map((c) => ({
      ...c,
      completedAt: c.completedAt.toISOString(),
    })),
    total: view.total,
  };

  return (
    <main className="min-h-screen bg-neutral-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          {branding.companyLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.companyLogoUrl}
              alt={branding.companyName ?? "Company logo"}
              className="h-8 w-auto"
            />
          ) : (
            <span className="font-semibold text-lg text-neutral-900">
              {branding.companyName ?? "OpsHub"}
            </span>
          )}
          <span className="text-xs text-neutral-500">Workflow portal</span>
        </header>

        <PortalClient token={token} view={serialized} />

        <p className="text-center text-xs text-neutral-400 mt-8">
          Signed in via your unique portal link · {subject.displayName}
        </p>
      </div>
    </main>
  );
}
