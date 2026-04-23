import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { compare } from "bcryptjs";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";

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
}

declare module "next-auth" {
  interface JWT {
    id: string;
    role: Role;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // Email lookup is case-insensitive — users shouldn't fail to log in
        // because they typed "Foo@Bar.com" when the stored value is
        // "foo@bar.com". We use findFirst with insensitive mode instead of
        // findUnique so legacy mixed-case rows still match.
        const email = (credentials.email as string).trim().toLowerCase();
        const user = await db.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
        });

        if (!user || !user.isActive || !user.hashedPassword) return null;

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
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;

      const rawEmail = user.email;
      if (!rawEmail) return false;

      // Normalize to lowercase — we never want two User rows for the same
      // Google identity just because the token returned different casing.
      const email = rawEmail.trim().toLowerCase();
      const domain = email.split("@")[1];
      if (!domain) return false;

      // Check domain allowlist — if rows exist, only those domains are allowed
      const allowedDomains = await db.allowedDomain.findMany();
      if (allowedDomains.length > 0) {
        const isAllowed = allowedDomains.some(
          (d) => d.domain.toLowerCase() === domain
        );
        if (!isAllowed) return false;
      }

      // Find or create user record for this Google account. findFirst with
      // insensitive mode so we pick up a legacy mixed-case row if it exists.
      const existing = await db.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
      });

      if (existing) {
        if (!existing.isActive) return false;
        // Update avatar from Google profile if not already set
        if (!existing.avatar && user.image) {
          await db.user.update({
            where: { id: existing.id },
            data: { avatar: user.image },
          });
        }
      } else {
        // Auto-provision new user from Google SSO. New users start as GUEST:
        // they can only see Intranet + Team until a manager/admin grants
        // additional access (typically by assigning them to a project).
        await db.user.create({
          data: {
            name: user.name || email.split("@")[0],
            email,
            authProvider: "google",
            avatar: user.image || null,
            role: "GUEST",
          },
        });
      }

      return true;
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
      } else if (token.id) {
        // Subsequent requests — re-read role from DB so server-side changes
        // (auto-promotion on assignment, admin role edits) take effect
        // without requiring the user to log out and back in.
        const dbUser = await db.user.findUnique({
          where: { id: token.id as string },
          select: { role: true },
        });
        if (dbUser) token.role = dbUser.role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as Role;
      return session;
    },
  },
});
