/**
 * Full Node-runtime NextAuth surface.
 *
 * This file extends the Edge-safe `authConfig` (src/auth.config.ts)
 * with everything that requires Prisma or other Node-only deps:
 *
 *   - The Credentials provider (uses Prisma + bcryptjs).
 *   - The Google sign-in callback (uses Prisma to auto-link existing
 *     accounts — see src/lib/auth-google-signin.ts).
 *   - The DB-aware branch of the jwt callback (looks up the User row
 *     to populate token.id / token.role on initial Google sign-in).
 *
 * src/middleware.ts must NOT import from this file — doing so pulls
 * Prisma, bcryptjs, and the rest of the Node-only surface into the
 * Edge bundle. Use authConfig from src/auth.config.ts instead.
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { db } from "@/lib/db";
import { handleGoogleSignIn } from "@/lib/auth-google-signin";
import { consume as consumeRateLimit, clientIpFromRequest } from "@/lib/rate-limit";
import { log } from "@/lib/log";
import type { Role } from "@prisma/client";
import { authConfig } from "@/auth.config";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = (credentials.email as string).trim().toLowerCase();

        // Rate-limit credential attempts. The bucket is keyed by the
        // requesting IP + the email being tried, so a single bad
        // actor can't lock a real user out by hammering their email
        // from a different IP. Capacity 5 / refill 1 per 30s gives ~5
        // burst attempts then 2 attempts/min sustained — fast enough
        // for a typo and slow enough to deter password-spray bots.
        // The limiter fails open if the storage layer crashes, so a
        // limiter bug never takes the login form down.
        const ip = request ? clientIpFromRequest(request as Request) : "unknown";
        const rl = consumeRateLimit(`auth:${ip}:${email}`, {
          capacity: 5,
          refillRatePerSec: 1 / 30,
        });
        if (!rl.allowed) {
          log.warn("auth.rateLimit", "Credentials login rate-limited", {
            ip,
            email,
            retryAfterMs: rl.retryAfterMs,
          });
          // Returning null surfaces as "Invalid email or password" on
          // the login form — same UX as a bad password, by design.
          // We deliberately don't tell the client they're throttled,
          // because that's information a brute-force script can use.
          return null;
        }

        // Email lookup is case-insensitive — users shouldn't fail to log in
        // because they typed "Foo@Bar.com" when the stored value is
        // "foo@bar.com". We use findFirst with insensitive mode instead of
        // findUnique so legacy mixed-case rows still match.
        const user = await db.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
        });

        if (!user || !user.isActive || !user.hashedPassword) return null;
        // Users without login access (synthetic-email placeholders or
        // tracked-only employees) should never reach this branch in
        // practice but we double-check so a future schema edit can't
        // regress it silently.
        if (!user.hasLoginAccess) return null;

        const isValid = await compare(
          credentials.password as string,
          user.hashedPassword
        );

        if (!isValid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      // Google flow lives in a separate, testable helper. Credentials
      // sign-ins fall through (the credentials provider's `authorize`
      // already gates them).
      return handleGoogleSignIn({ user, account, profile }, { db });
    },
    async jwt({ token, user, account }) {
      // On initial sign-in, populate token from user object or DB
      if (user && account?.provider === "credentials") {
        token.id = user.id as string;
        token.role = user.role;
      } else if (account?.provider === "google") {
        // Look up the DB user to get id and role (case-insensitive)
        const tokenEmail = ((token.email as string) || "").trim().toLowerCase();
        const dbUser = tokenEmail
          ? await db.user.findFirst({
              where: { email: { equals: tokenEmail, mode: "insensitive" } },
            })
          : null;
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
        }
      }
      // NOTE: we intentionally do NOT re-read the role from DB here.
      // The jwt callback runs in Edge Runtime (via middleware) where
      // Prisma is unavailable. Server-side role changes are picked up
      // by requireAuth() and freshRole() which run on the Node server.
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as Role;
      return session;
    },
  },
});
