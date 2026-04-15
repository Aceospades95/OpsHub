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

        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
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

      const email = user.email;
      if (!email) return false;

      const domain = email.split("@")[1]?.toLowerCase();
      if (!domain) return false;

      // Check domain allowlist — if rows exist, only those domains are allowed
      const allowedDomains = await db.allowedDomain.findMany();
      if (allowedDomains.length > 0) {
        const isAllowed = allowedDomains.some(
          (d) => d.domain.toLowerCase() === domain
        );
        if (!isAllowed) return false;
      }

      // Find or create user record for this Google account
      const existing = await db.user.findUnique({ where: { email } });

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
        // Auto-provision new user from Google SSO
        await db.user.create({
          data: {
            name: user.name || email.split("@")[0],
            email,
            authProvider: "google",
            avatar: user.image || null,
            role: "VIEWER",
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
        // Look up the DB user to get id and role
        const dbUser = await db.user.findUnique({
          where: { email: token.email as string },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
        }
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
