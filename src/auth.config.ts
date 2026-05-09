/**
 * Edge-safe NextAuth configuration.
 *
 * This module is imported by both:
 *   - src/middleware.ts (runs in Edge runtime — Prisma, bcryptjs, and
 *     anything that touches `node:` APIs are unavailable here).
 *   - src/lib/auth.ts (runs in Node runtime — extends this config
 *     with the Credentials provider, the Prisma-aware signIn / jwt
 *     callbacks, and the auth-google-signin helper).
 *
 * Keep this file Prisma-free and bcrypt-free. Adding a heavy import
 * here re-inflates the middleware bundle, which is one of the
 * leading-suspect causes of the RSC 503 storm documented in
 * docs/rsc-503-diagnosis.md (R10-5).
 *
 * See R11-E for the rationale on the split.
 */

import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import type { Role } from "@prisma/client";

// Module-augmentation lives here so middleware (which only imports
// authConfig) and the full auth surface (src/lib/auth.ts) both see
// the same Session/User/JWT shape without duplicating the declares.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: Role;
    };
  }
  interface User {
    role: Role;
  }
  interface JWT {
    id: string;
    role: Role;
  }
}

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  // Google is Edge-safe (no Node-only APIs in next-auth's Google
  // provider — the OAuth dance is done via fetch). Credentials lives
  // in src/lib/auth.ts because its `authorize()` callback uses
  // Prisma + bcryptjs, neither of which can run in Edge.
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    /**
     * Session callback. Edge-safe — purely token → session shape
     * mapping with no DB calls. The same callback runs in Node too;
     * src/lib/auth.ts re-uses this verbatim.
     */
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
    /**
     * JWT callback. The Edge-safe path is a no-op pass-through —
     * middleware just re-validates an existing JWT, it doesn't
     * issue tokens, so nothing here needs to call Prisma.
     *
     * The full Node-side implementation in src/lib/auth.ts overrides
     * this with the DB-lookup logic for the initial credentials and
     * Google sign-in flow (where `user`/`account` are set).
     */
    async jwt({ token }) {
      return token;
    },
  },
} satisfies NextAuthConfig;
