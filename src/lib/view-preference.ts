import { cookies } from "next/headers";

/**
 * Per-module remembered list view (table vs cards vs tree/pipeline).
 *
 * Resolution order:
 *   1. explicit ?view= URL param (shareable links always win),
 *   2. the viewer's last choice, remembered in a per-module cookie
 *      written by ViewOptionsBar,
 *   3. the module's default — TABLE wherever one exists: tables scan,
 *      sort, and bulk-manage better than cards for operational data.
 *
 * Cookie (not DB) on purpose: zero schema, survives refreshes and
 * deploys, per-device like every other display preference here.
 */
export const VIEW_COOKIE_PREFIX = "ohview.";

export function resolveViewPreference(
  param: string | undefined,
  moduleKey: string,
  allowed: readonly string[],
  fallback: string
): string {
  if (param && allowed.includes(param)) return param;
  try {
    const remembered = cookies().get(`${VIEW_COOKIE_PREFIX}${moduleKey}`)?.value;
    if (remembered && allowed.includes(remembered)) return remembered;
  } catch {
    /* cookies() unavailable (e.g. static render) — fall through */
  }
  return fallback;
}
