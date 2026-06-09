import { requireAuth } from "@/lib/permissions";
import { redirect, notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getImporter } from "@/lib/importers";
import { ImportWizard } from "./import-wizard";

interface Props {
  params: Promise<{ key: string }>;
}

export default async function ImporterDetailPage({ params }: Props) {
  const { key } = await params;
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const importer = getImporter(key);
  if (!importer) notFound();

  return (
    <div>
      <PageHeader
        title={`Import: ${importer.name}`}
        description={importer.description}
        actions={
          <Link
            href="/admin/import"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to importers
          </Link>
        }
      />
      <ImportWizard
        importerKey={importer.key}
        supportsExport={typeof importer.exportRows === "function"}
        supportsUpsert={!!importer.supportsUpsert}
        upsertKeyDescription={importer.upsertKeyDescription}
        fields={importer.fields.map((f) => ({
          key: f.key,
          label: f.label,
          required: f.required,
          description: f.description || null,
        }))}
      />
    </div>
  );
}
