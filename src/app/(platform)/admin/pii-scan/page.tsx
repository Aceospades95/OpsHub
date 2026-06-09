import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldCheck } from "lucide-react";

/**
 * Admin-only PII / real-data scanner.
 *
 * Round-4 QA found that the deployed testing instance carried real
 * emails, real domain references, and real user records left over
 * from earlier dev/seed work. Scrubbing the seed file fixes future
 * builds, but this page lets an operator find and clean out the
 * residual rows BEFORE flipping a customer to production. It is
 * read-only — every "fix" is just a deep-link to the appropriate
 * UI (Users, Email Log, SSO, Theme) where the operator can make
 * the call.
 *
 * Flagged patterns are loaded from the PII_FLAG_PATTERNS env var
 * (comma-separated case-insensitive substrings). This avoids
 * embedding any specific operator/customer string in source — the
 * deploying team configures their own watch-list at runtime. If
 * unset, the page reports no hits.
 */

function loadFlaggedPatterns(): RegExp[] {
  const raw = process.env.PII_FLAG_PATTERNS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // Treat each entry as a literal substring (escape regex chars)
      // so operators don't have to think about regex syntax.
      const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(escaped, "i");
    });
}

const FLAGGED_PATTERNS = loadFlaggedPatterns();

function flagged(text: string | null | undefined): boolean {
  if (!text) return false;
  return FLAGGED_PATTERNS.some((re) => re.test(text));
}

interface UserHit {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

interface EmailHit {
  id: string;
  to: string;
  from: string;
  subject: string;
  sentAt: Date;
  status: string;
}

interface DomainHit {
  id: string;
  domain: string;
}

interface ThemeHit {
  id: string;
  key: string;
  value: string;
}

export const metadata = { title: "PII Scan · OpsHub" };

export default async function PiiScanPage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  // Gather candidate rows. Each query is small (admin-scoped tables)
  // so we can pull and filter in JS rather than building the regex
  // logic twice — once on the DB side, once on the client side.
  const [users, emails, domains, themeSettings] = await Promise.all([
    db.user.findMany({
      select: { id: true, name: true, email: true, isActive: true },
      orderBy: { email: "asc" },
    }),
    db.emailLog.findMany({
      select: { id: true, toAddresses: true, fromAddress: true, subject: true, sentAt: true, status: true },
      orderBy: { sentAt: "desc" },
      take: 200,
    }),
    db.allowedDomain.findMany({
      select: { id: true, domain: true },
      orderBy: { domain: "asc" },
    }),
    db.themeSetting.findMany({
      select: { id: true, key: true, value: true },
    }),
  ]);

  const userHits: UserHit[] = users.filter((u) => flagged(u.email) || flagged(u.name));
  const emailHits: EmailHit[] = emails
    .filter((e) => flagged(e.toAddresses) || flagged(e.fromAddress) || flagged(e.subject))
    .map((e) => ({ id: e.id, to: e.toAddresses, from: e.fromAddress, subject: e.subject, sentAt: e.sentAt, status: e.status }));
  const domainHits: DomainHit[] = domains.filter((d) => flagged(d.domain));
  const themeHits: ThemeHit[] = themeSettings.filter((t) => flagged(t.value) || flagged(t.key));

  const totalHits = userHits.length + emailHits.length + domainHits.length + themeHits.length;

  return (
    <div>
      <PageHeader
        title="PII Scan"
        description="Find rows containing real customer-or-operator strings (real emails, real domains, leftover demo accounts) so they can be cleaned via the UI before promoting this DB to production."
      />

      {totalHits === 0 ? (
        <Card>
          <CardContent className="p-8 flex items-start gap-3">
            <ShieldCheck className="h-6 w-6 text-success shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">No flagged rows.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Nothing in the User, EmailLog, AllowedDomain, or ThemeSetting tables matches the
                configured flagged patterns. Patterns are loaded from the <code>PII_FLAG_PATTERNS</code> env var
                (comma-separated substrings, case-insensitive). Currently configured: {FLAGGED_PATTERNS.length}.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-4 flex items-start gap-3 bg-warning/5 border-warning/30">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium">{totalHits} flagged row(s) found.</p>
                <p className="text-muted-foreground mt-1">
                  This page is read-only. Use the linked admin UIs to clean each row, then re-run this scan.
                </p>
              </div>
            </CardContent>
          </Card>

          {userHits.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  Users ({userHits.length})
                  <Badge variant="outline" className="text-[10px]">edit at /admin/users</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Name</th>
                      <th className="px-4 py-2 text-left font-medium">Email</th>
                      <th className="px-4 py-2 text-left font-medium">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userHits.map((u) => (
                      <tr key={u.id} className="border-t border-border">
                        <td className="px-4 py-2">{u.name}</td>
                        <td className="px-4 py-2 font-mono text-xs">{u.email}</td>
                        <td className="px-4 py-2">{u.isActive ? "yes" : "no"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </CardContent>
            </Card>
          )}

          {emailHits.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  Email log ({emailHits.length} of last 200 rows)
                  <Badge variant="outline" className="text-[10px]">audit at /admin/emails</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Sent</th>
                      <th className="px-4 py-2 text-left font-medium">From</th>
                      <th className="px-4 py-2 text-left font-medium">To</th>
                      <th className="px-4 py-2 text-left font-medium">Subject</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emailHits.map((e) => (
                      <tr key={e.id} className="border-t border-border">
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {e.sentAt.toISOString().slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{e.from}</td>
                        <td className="px-4 py-2 font-mono text-xs truncate max-w-[260px]">{e.to}</td>
                        <td className="px-4 py-2 truncate max-w-[260px]">{e.subject}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{e.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </CardContent>
            </Card>
          )}

          {domainHits.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  SSO allowed domains ({domainHits.length})
                  <Badge variant="outline" className="text-[10px]">edit at /admin/sso</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-1">
                  {domainHits.map((d) => (
                    <li key={d.id} className="font-mono text-xs">{d.domain}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {themeHits.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  Theme settings ({themeHits.length})
                  <Badge variant="outline" className="text-[10px]">edit at /admin/theme</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Key</th>
                      <th className="px-4 py-2 text-left font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {themeHits.map((t) => (
                      <tr key={t.id} className="border-t border-border">
                        <td className="px-4 py-2 font-mono text-xs">{t.key}</td>
                        <td className="px-4 py-2 truncate max-w-[400px]">{t.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
