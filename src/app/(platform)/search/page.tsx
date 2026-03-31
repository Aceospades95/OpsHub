import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import Link from "next/link";

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id: userId, role } = session.user;
  const query = q?.trim() || "";

  if (!query) {
    return (
      <div>
        <PageHeader title="Search" description="Search across all modules" />
        <div className="flex flex-col items-center py-12 text-muted-foreground">
          <Search className="h-12 w-12 mb-4" />
          <p>Enter a search term to find clients, projects, contracts, and suppliers</p>
        </div>
      </div>
    );
  }

  const clientPerms = await resolveModulePerms(userId, role, "clients");
  const projectPerms = await resolveModulePerms(userId, role, "projects");
  const contractPerms = await resolveModulePerms(userId, role, "contracts");
  const supplierPerms = await resolveModulePerms(userId, role, "suppliers");

  const [clients, projects, contracts, suppliers] = await Promise.all([
    clientPerms.canView
      ? db.client.findMany({
          where: { OR: [{ name: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] },
          take: 10,
        })
      : [],
    projectPerms.canView
      ? db.project.findMany({
          where: { OR: [{ name: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] },
          include: { client: { select: { name: true } } },
          take: 10,
        })
      : [],
    contractPerms.canView
      ? db.contract.findMany({
          where: { OR: [{ title: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] },
          include: { client: { select: { name: true } } },
          take: 10,
        })
      : [],
    supplierPerms.canView
      ? db.supplier.findMany({
          where: { OR: [{ name: { contains: query, mode: "insensitive" } }, { notes: { contains: query, mode: "insensitive" } }] },
          take: 10,
        })
      : [],
  ]);

  const totalResults = clients.length + projects.length + contracts.length + suppliers.length;

  return (
    <div>
      <PageHeader
        title={`Search Results for "${query}"`}
        description={`${totalResults} result${totalResults !== 1 ? "s" : ""} found`}
      />

      <div className="space-y-6">
        {clients.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Clients ({clients.length})</h2>
            <div className="space-y-2">
              {clients.map((client) => (
                <Link key={client.id} href={`/clients/${client.id}`}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{client.name}</p>
                        {client.industry && <p className="text-sm text-muted-foreground">{client.industry}</p>}
                      </div>
                      <StatusBadge status={client.status} />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {projects.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Projects ({projects.length})</h2>
            <div className="space-y-2">
              {projects.map((project) => (
                <Link key={project.id} href={`/projects/${project.id}`}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{project.name}</p>
                        <p className="text-sm text-muted-foreground">{project.client.name}</p>
                      </div>
                      <StatusBadge status={project.status} />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {contracts.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Contracts ({contracts.length})</h2>
            <div className="space-y-2">
              {contracts.map((contract) => (
                <Link key={contract.id} href={`/contracts/${contract.id}`}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{contract.title}</p>
                        <p className="text-sm text-muted-foreground">{contract.client.name}</p>
                      </div>
                      <StatusBadge status={contract.status} />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {suppliers.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Suppliers ({suppliers.length})</h2>
            <div className="space-y-2">
              {suppliers.map((supplier) => (
                <Link key={supplier.id} href={`/suppliers/${supplier.id}`}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{supplier.name}</p>
                        <Badge variant="outline">{supplier.category}</Badge>
                      </div>
                      <StatusBadge status={supplier.status} />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {totalResults === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-4" />
            <p>No results found for &quot;{query}&quot;</p>
          </div>
        )}
      </div>
    </div>
  );
}
