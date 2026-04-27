import { randomBytes, createHash } from "crypto";

/**
 * Public quote token utilities.
 *
 * The token is what gates access to the public quote view at `/q/:token`.
 * It needs to be:
 *
 *   1. Hard to guess — the client receives it in an email and shares the
 *      URL with stakeholders who never sign in. 32 bytes of CSPRNG entropy
 *      put it well past the brute-force horizon for any practical attacker.
 *   2. Comparable in constant time on lookup, so timing-channel attacks
 *      can't reveal token validity. The lookup itself runs through Prisma
 *      which compares strings as bytea — fine — but if we ever move to a
 *      hashed storage form we keep `hashToken()` ready.
 *   3. URL-safe — base64url avoids `+`, `/`, and `=` so the token survives
 *      copy-paste, link shorteners, and being typed by humans.
 *
 * We currently store the raw token in the database (not the hash) so the
 * route handler can hand it back in absolute share URLs. If a leak ever
 * matters more than the convenience, swap `Quote.publicToken` to store
 * `hashToken(raw)` and have the server compare with constant-time eq.
 */

const TOKEN_BYTES = 32;

export function generateQuoteToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Stable SHA-256 hash of a token. Reserved for a future migration to
 * hashed storage; not currently used by the lookup path.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
