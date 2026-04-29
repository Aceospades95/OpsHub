import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { compare } from "bcryptjs";
import { db } from "@/lib/db";
import { handleGoogleSignIn } from "@/lib/auth-google-signin";
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
