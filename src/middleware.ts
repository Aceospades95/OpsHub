/**
 * Middleware runs in the Edge Runtime, where Prisma, bcryptjs, and
 * other Node-only deps are unavailable. This file imports ONLY the
 * Edge-safe authConfig (src/auth.config.ts), not the full surface
 * from src/lib/auth.ts. See R11-E for rationale — pre-split, the
 * middleware bundle hit ~111 kB because it transitively pulled
 * Prisma + bcrypt + the Google sign-in helper, all of which are
 * never used here.
 */

import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Public routes are reachable without a session. The workflow portal
  // routes (/portal/:token, /api/public/portal/:token) are how new
  // hires fill out forms, upload documents, and sign agreements
  // without an OpsHub account. None of these may require a login.
  // /api/jobs/ is also public because the cron runner authenticates
  // itself via the x-cron-secret header — middleware would otherwise
  // 307 the unauthenticated POST from cron providers to /login.
  // /api/files/ is public at the middleware layer because the route
  // itself enforces visibility (public files served to anyone, private
  // files require a session). Without this entry, the login page's
  // <img src="/api/files/{logoId}"> fetch gets 307'd to /login and
  // the logo renders broken until the user signs in.
  //
  // /register is deliberately NOT in this list — self-registration is
  // disabled (see src/actions/auth.ts:registerAction). Anyone hitting
  // /register gets bounced to /login.
  // Prefix entries end with "/" so the match is segment-aligned —
  // a bare startsWith("/api/health") would also make a hypothetical
  // /api/health-internal public. Exact entries match the whole path.
  const publicExact = ["/login", "/api/health"];
  const publicPrefixes = [
    "/api/auth/",
    "/api/health/",
    "/api/jobs/",
    "/api/files/",
    "/portal/",
    "/api/public/",
    // /signup/[token] is the set-password page invitees land on. The
    // token validation (src/lib/signup-tokens.ts) IS the auth check
    // here — anyone who has a valid unused un-expired token gets to
    // pick a password for the user they were invited as.
    "/signup/",
  ];
  const isPublic =
    publicExact.includes(pathname) ||
    publicPrefixes.some((p) => pathname.startsWith(p));

  if (!req.auth && !isPublic) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  if (req.auth && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (pathname === "/") {
    if (req.auth) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
