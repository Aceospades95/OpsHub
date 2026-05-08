/**
 * Find any column that points at a File row that no longer exists,
 * and null it out. Surfaced by the round-2 QA run: a single page
 * load was firing 22+ requests to `/api/files/<id>` for an id that
 * always 404'd because the File row had been deleted but a stale
 * User.avatar / ThemeSetting still pointed at it. SafeImg now
 * caches the failure client-side, but the underlying data is still
 * dirty — this script clears the dangling pointers so future
 * sessions don't re-introduce the spam.
 *
 * Tables scanned:
 *   - User.avatar       (string column — could be a File.id, a URL,
 *                        or an SSO-provided remote URL; we only null
 *                        when it looks like a cuid AND the File row
 *                        is missing)
 *   - ThemeSetting rows whose key is `branding.companyLogoFileId` or
 *     `branding.backgroundImageFileId` and whose value points at a
 *     missing File.id — delete the row entirely (caller falls back
 *     to default branding).
 *
 * Safety
 * ------
 * DRY-RUN by default. Set DRY_RUN=false to commit. Conservative: a
 * mismatched value pattern (URL, non-cuid, etc.) is left alone.
 *
 * Usage
 * -----
 *   npx tsx prisma/cleanup-orphan-file-refs.ts                # preview
 *   DRY_RUN=false npx tsx prisma/cleanup-orphan-file-refs.ts  # commit
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

/** Cuid format check — Prisma's @default(cuid()) produces 25-char
 *  ids prefixed with "c". Avatars from Google sign-in are full URLs
 *  starting with "https://" — those are left alone regardless. */
const CUID_PATTERN = /^c[a-z0-9]{24,}$/;

async function main(): Promise<void> {
  const banner = DRY_RUN ? "[DRY-RUN]" : "[LIVE]";
  console.log(`${banner} cleanup-orphan-file-refs\n`);

  // 1) User.avatar pointing at a missing File.
  const usersWithAvatar = await db.user.findMany({
    where: { avatar: { not: null } },
    select: { id: true, name: true, avatar: true },
  });
  const candidateAvatarIds = usersWithAvatar
    .map((u) => u.avatar!)
    .filter((v) => CUID_PATTERN.test(v));

  let avatarOrphans: { userId: string; name: string; fileId: string }[] = [];
  if (candidateAvatarIds.length > 0) {
    const existingFiles = await db.file.findMany({
      where: { id: { in: candidateAvatarIds } },
      select: { id: true },
    });
    const existing = new Set(existingFiles.map((f) => f.id));
    avatarOrphans = usersWithAvatar
      .filter((u) => CUID_PATTERN.test(u.avatar!) && !existing.has(u.avatar!))
      .map((u) => ({ userId: u.id, name: u.name, fileId: u.avatar! }));
  }

  // 2) ThemeSetting rows for branding.companyLogoFileId /
  //    branding.backgroundImageFileId pointing at a missing File.
  const brandingKeys = [
    "branding.companyLogoFileId",
    "branding.backgroundImageFileId",
  ];
  const brandingRows = await db.themeSetting.findMany({
    where: { key: { in: brandingKeys } },
  });
  const brandingFileIds = brandingRows.map((r) => r.value);
  let brandingOrphans: { key: string; fileId: string }[] = [];
  if (brandingFileIds.length > 0) {
    const existing = new Set(
      (
        await db.file.findMany({
          where: { id: { in: brandingFileIds } },
          select: { id: true },
        })
      ).map((f) => f.id)
    );
    brandingOrphans = brandingRows
      .filter((r) => !existing.has(r.value))
      .map((r) => ({ key: r.key, fileId: r.value }));
  }

  if (avatarOrphans.length === 0 && brandingOrphans.length === 0) {
    console.log("No orphan file references found. Nothing to do.");
    return;
  }

  if (avatarOrphans.length > 0) {
    console.log(`User.avatar orphans (${avatarOrphans.length}):`);
    for (const o of avatarOrphans) {
      console.log(`  ${o.userId}  ${o.name}  → ${o.fileId}`);
    }
  }
  if (brandingOrphans.length > 0) {
    console.log(`\nBranding orphans (${brandingOrphans.length}):`);
    for (const o of brandingOrphans) {
      console.log(`  ${o.key}  → ${o.fileId}`);
    }
  }

  if (DRY_RUN) {
    console.log("\nNo changes made. Re-run with DRY_RUN=false to apply.");
    return;
  }

  if (avatarOrphans.length > 0) {
    await db.user.updateMany({
      where: { id: { in: avatarOrphans.map((o) => o.userId) } },
      data: { avatar: null },
    });
    console.log(`\nNulled ${avatarOrphans.length} User.avatar reference(s).`);
  }
  if (brandingOrphans.length > 0) {
    await db.themeSetting.deleteMany({
      where: { key: { in: brandingOrphans.map((o) => o.key) } },
    });
    console.log(`Deleted ${brandingOrphans.length} branding ThemeSetting row(s).`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
