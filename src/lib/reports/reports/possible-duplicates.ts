/**
 * possible-duplicates — data-hygiene sweep for the records the CSV
 * importers guard at write time.
 *
 * Surfaces groups of likely duplicate records that are already in the
 * database (imported before the guardrails, or hand-entered):
 *
 *   - projects sharing a normalized name within the SAME client
 *   - clients sharing a normalized name
 *   - contacts sharing an email, or a normalized name + organization
 *   - certifications sharing a normalized name for the same client
 *     (or both internal) — the "State of Illinois twice" case
 *
 * Normalization matches the importers' guardrail (normalizeImportName:
 * lowercase, collapsed whitespace, trailing punctuation stripped) so
 * what this report flags is exactly what a re-import would flag.
 * Read-only — merging/renaming happens in the UI. On-demand only
 * (schedulable: false): the list barely changes day to day and would
 * be noise in a digest.
 */

import { db } from "@/lib/db";
import type { ReportDefinition, ReportOutput } from "../types";
import { normalizeImportName } from "@/lib/importers/importers/clients";

interface DupGroupRow extends Record<string, unknown> {
  kind: string;
  name: string;
  count: number;
  members: string;
}

/** "Name (id), Name (id), …" — ids let admins act without links. */
function memberList(members: { id: string; label: string }[]): string {
  return members.map((m) => `${m.label} (${m.id})`).join(", ");
}

/** Collect map values with more than one entry, as report rows. */
function groupsOf<T extends { id: string; label: string }>(
  byKey: Map<string, T[]>,
  kind: string,
  nameOf: (members: T[]) => string
): DupGroupRow[] {
  const rows: DupGroupRow[] = [];
  // Array.from — the tsconfig target predates MapIterator for-of.
  for (const members of Array.from(byKey.values())) {
    if (members.length < 2) continue;
    rows.push({
      kind,
      name: nameOf(members),
      count: members.length,
      members: memberList(members),
    });
  }
  return rows;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export const possibleDuplicates: ReportDefinition = {
  key: "possible-duplicates",
  name: "Possible duplicate records",
  description:
    "Likely duplicates already in the database: projects sharing a near-identical name on the same client, clients with near-identical names, contacts sharing an email or name + organization, and certifications repeating a name for the same client. Merge or rename them so imports and pickers stay clean.",
  module: "admin",
  schedulable: false,

  async run(): Promise<ReportOutput> {
    const [projects, clients, certifications] = await Promise.all([
      db.project.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          clientId: true,
          client: { select: { name: true } },
        },
      }),
      db.client.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
      }),
      db.certification.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          clientId: true,
          expirationDate: true,
        },
      }),
    ]);

    // Contacts live in the CRM `Contact` table, which may not exist on
    // installs that haven't run the crm_contacts migration — query
    // defensively and just skip the section when it isn't there.
    type ContactRow = {
      id: string;
      name: string;
      email: string | null;
      organization: string | null;
    };
    let contacts: ContactRow[] = [];
    try {
      const delegate = (
        db as unknown as {
          contact?: { findMany?: (args: unknown) => Promise<ContactRow[]> };
        }
      ).contact;
      if (delegate?.findMany) {
        contacts = await delegate.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true, email: true, organization: true },
        });
      }
    } catch {
      contacts = [];
    }

    // ── Projects: normalized name within the same client ──────────
    const projectGroups = new Map<string, { id: string; label: string; clientName: string }[]>();
    for (const p of projects) {
      const norm = normalizeImportName(p.name);
      if (!norm) continue;
      push(projectGroups, `${norm}|${p.clientId}`, {
        id: p.id,
        label: p.name,
        clientName: p.client?.name ?? "Unknown client",
      });
    }
    const projectRows = groupsOf(
      projectGroups,
      "Projects (same client)",
      (members) => `${members[0].label} — ${members[0].clientName}`
    );

    // ── Clients: normalized name ──────────────────────────────────
    const clientGroups = new Map<string, { id: string; label: string }[]>();
    for (const c of clients) {
      const norm = normalizeImportName(c.name);
      if (!norm) continue;
      push(clientGroups, norm, { id: c.id, label: c.name });
    }
    const clientRows = groupsOf(clientGroups, "Clients", (members) => members[0].label);

    // ── Certifications: normalized name within the same client scope ──
    // Two rows named "State of Illinois" are almost certainly one cert
    // entered twice. clientId (or "internal") scopes the key so a cert
    // legitimately held per-client isn't flagged; the expiry hint in the
    // label tells the admin which row is the stale one to retire.
    const certGroups = new Map<string, { id: string; label: string }[]>();
    for (const c of certifications) {
      const norm = normalizeImportName(c.name);
      if (!norm) continue;
      push(certGroups, `${norm}|${c.clientId ?? "internal"}`, {
        id: c.id,
        label: c.expirationDate
          ? `${c.name} (expires ${c.expirationDate.toISOString().slice(0, 10)})`
          : c.name,
      });
    }
    const certRows = groupsOf(certGroups, "Certifications", (members) => members[0].label);

    // ── Contacts: shared email, then normalized name + organization ─
    const emailGroups = new Map<string, { id: string; label: string }[]>();
    const nameOrgGroups = new Map<string, { id: string; label: string }[]>();
    for (const c of contacts) {
      const email = (c.email ?? "").trim().toLowerCase();
      if (email) {
        push(emailGroups, email, { id: c.id, label: c.name });
      }
      const normName = normalizeImportName(c.name);
      if (normName) {
        const normOrg = normalizeImportName(c.organization ?? "");
        push(nameOrgGroups, `${normName}|${normOrg}`, {
          id: c.id,
          label: c.organization ? `${c.name} (${c.organization})` : c.name,
        });
      }
    }
    const contactEmailRows = groupsOf(emailGroups, "Contacts (same email)", (members) => {
      // The shared email is the group identity, not any one member name.
      const email = contacts.find((c) => c.id === members[0].id)?.email ?? members[0].label;
      return email ?? members[0].label;
    });
    // Skip name+org groups whose member set is already reported as an
    // email group — one entry per real-world duplicate is enough.
    // Compare by sorted member-id signature (labels differ per kind).
    const idSignature = (members: { id: string }[]) =>
      members.map((m) => m.id).sort().join("|");
    const emailSignatures = new Set<string>();
    for (const members of Array.from(emailGroups.values())) {
      if (members.length >= 2) emailSignatures.add(idSignature(members));
    }
    const nameOrgFiltered = new Map<string, { id: string; label: string }[]>();
    for (const [key, members] of Array.from(nameOrgGroups.entries())) {
      if (emailSignatures.has(idSignature(members))) continue;
      nameOrgFiltered.set(key, members);
    }
    const contactNameRows = groupsOf(
      nameOrgFiltered,
      "Contacts (same name + organization)",
      (members) => members[0].label
    );

    const rows: DupGroupRow[] = [
      ...projectRows,
      ...clientRows,
      ...certRows,
      ...contactEmailRows,
      ...contactNameRows,
    ].sort((a, b) => a.kind.localeCompare(b.kind) || b.count - a.count || a.name.localeCompare(b.name));

    const contactGroupCount = contactEmailRows.length + contactNameRows.length;
    const summary =
      rows.length === 0
        ? "No possible duplicates found — project, client, certification, and contact names look clean."
        : `${rows.length} possible duplicate group${rows.length === 1 ? "" : "s"}: ` +
          `${projectRows.length} project, ${clientRows.length} client, ${certRows.length} certification, ${contactGroupCount} contact.`;

    return {
      summary,
      columns: [
        { key: "kind", label: "Kind" },
        { key: "name", label: "Name" },
        { key: "count", label: "Records", align: "right" },
        { key: "members", label: "Group members (id)" },
      ],
      rows,
      emptyMessage: "No possible duplicates found.",
    };
  },
};
