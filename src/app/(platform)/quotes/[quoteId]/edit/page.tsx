import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { getBranding } from "@/lib/branding";
import { canAccessQuote } from "@/lib/quotes/access";

import { QuoteEditor } from "./quote-editor";

interface Props {
  params: Promise<{ quoteId: string }>;
}

export default async function QuoteEditPage({ params }: Props) {
  const { quoteId } = await params;
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canEdit) {
    return (
      <AccessDenied
        module="quotes"
        moduleLabel="Quotes"
        moduleDescription="Sales quotes, line-item builder, templates, and catalog"
      />
    );
  }

  const [quote, clients, projects, users, catalog, branding] = await Promise.all([
    db.quote.findFirst({
      where: { id: quoteId, deletedAt: null },
      include: { lineItems: { orderBy: { position: "asc" } } },
    }),
    db.client.findMany({
      where: { status: { in: ["ACTIVE", "PROSPECT"] }, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({
      where: { status: { in: ["PLANNING", "ACTIVE"] }, deletedAt: null },
      select: { id: true, name: true, clientId: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { isActive: true, hasLoginAccess: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.catalogItem.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        defaultUnitPrice: true,
        defaultUnit: true,
        category: true,
        isRecurring: true,
      },
      orderBy: { name: "asc" },
    }),
    getBranding(),
  ]);

  if (!quote) notFound();
  // Non-org-wide roles only reach their own quotes — see lib/quotes/access.
  if (!canAccessQuote(user, quote)) notFound();

  // Prefill for "Email quote" — the client's primary contact (or first
  // contact with an email).
  const primaryContact = await db.clientContact.findFirst({
    where: { clientId: quote.clientId, email: { not: null } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { email: true },
  });

  const editable = quote.status === "DRAFT" || quote.status === "REVISED";
  if (!editable) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
        <h1 className="text-xl font-semibold">This quote can&apos;t be edited</h1>
        <p className="text-sm text-muted-foreground">
          Quotes in status <strong>{quote.status}</strong> are locked.
          Create a revision to make changes.
        </p>
      </div>
    );
  }

  // Serialize for the client component boundary — Date instances and
  // server-only objects don't cross.
  const initial = {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    clientId: quote.clientId,
    projectId: quote.projectId,
    title: quote.title,
    introText: quote.introText,
    assumptionsText: quote.assumptionsText,
    termsText: quote.termsText,
    currency: quote.currency,
    discountType: quote.discountType,
    discountValue: quote.discountValue,
    taxRate: quote.taxRate,
    validUntil: quote.validUntil ? quote.validUntil.toISOString().slice(0, 10) : null,
    assignedToId: quote.assignedToId,
    internalNotes: quote.internalNotes,
    status: quote.status,
    lineItems: quote.lineItems.map((li, i) => ({
      clientId: `srv-${li.id}`,
      position: li.position ?? i,
      groupLabel: li.groupLabel,
      isOptional: li.isOptional,
      isSelected: li.isSelected,
      catalogItemId: li.catalogItemId,
      name: li.name,
      description: li.description,
      quantity: li.quantity,
      unit: li.unit,
      unitPrice: li.unitPrice,
      discountType: li.discountType,
      discountValue: li.discountValue,
      isRecurring: li.isRecurring,
      recurringInterval: li.recurringInterval,
    })),
  };

  return (
    <QuoteEditor
      initial={initial}
      clients={clients}
      projects={projects}
      users={users}
      catalog={catalog}
      branding={{
        companyName: branding.companyName,
        companyLogoUrl: branding.companyLogoUrl,
      }}
      defaultRecipient={primaryContact?.email ?? null}
    />
  );
}
