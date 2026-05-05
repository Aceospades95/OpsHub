import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

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
  const publicPaths = [
    "/login",
    "/api/auth",
    "/api/health",
    "/api/jobs/",
    "/api/files/",
    "/portal/",
    "/api/public/",
  ];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

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
