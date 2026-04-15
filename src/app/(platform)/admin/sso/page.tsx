import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, Info } from "lucide-react";
import { DomainManager } from "./domain-manager";

export default async function AdminSsoPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const domains = await db.allowedDomain.findMany({
    orderBy: { createdAt: "asc" },
  });

  const googleConfigured = !!(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );

  const googleUserCount = await db.user.count({
    where: { authProvider: "google" },
  });

  return (
    <div>
      <PageHeader
        title="Single Sign-On"
        description="Configure Google SSO and manage which email domains are allowed to sign in."
      />

      {/* Status card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Google SSO Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Provider:</span>
            {googleConfigured ? (
              <Badge variant="default">Configured</Badge>
            ) : (
              <Badge variant="secondary">Not configured</Badge>
            )}
          </div>
          {!googleConfigured && (
            <div className="flex items-start gap-2 rounded bg-muted p-3 text-sm text-muted-foreground">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Set <code className="text-xs bg-background px-1 py-0.5 rounded">GOOGLE_CLIENT_ID</code> and{" "}
                <code className="text-xs bg-background px-1 py-0.5 rounded">GOOGLE_CLIENT_SECRET</code> environment
                variables to enable Google SSO.
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Users signed in via Google:</span>
            <span className="text-sm font-medium">{googleUserCount}</span>
          </div>
        </CardContent>
      </Card>

      {/* Domain allowlist */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Allowed Email Domains</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Only users with email addresses from these domains can sign in with Google.
            If no domains are listed, all Google accounts are allowed.
          </p>
        </CardHeader>
        <CardContent>
          <DomainManager domains={domains} />
        </CardContent>
      </Card>
    </div>
  );
}
