import Link from "next/link";
import { peekSignupToken } from "@/lib/signup-tokens";
import { getBranding } from "@/lib/branding";
import { SignupForm } from "./signup-form";

/**
 * Public set-password page reached from the invite / reset email.
 *
 * The middleware exempts `/signup/` so this route runs without an
 * authenticated session — that's by design; the recipient doesn't
 * have a password yet, and `peekSignupToken` validation IS the auth
 * here. Tokens are single-use, expire in 24h, and never live on
 * disk in raw form.
 *
 * Three render paths:
 *   - Valid token → show the SignupForm.
 *   - Expired / used / missing → show a friendly page pointing the
 *     recipient at /login with a hint to ask their admin for a fresh
 *     link.
 */

interface Props {
  params: Promise<{ token: string }>;
}

const REASON_COPY: Record<
  "missing" | "expired" | "used",
  { title: string; body: string }
> = {
  missing: {
    title: "Link not recognized",
    body:
      "This invite link doesn't match anything in our records. Ask whoever invited you to send a fresh link.",
  },
  expired: {
    title: "Invite link expired",
    body:
      "Invite links expire after 24 hours. Ask the admin who invited you to send a new one — clicking it will replace this expired link automatically.",
  },
  used: {
    title: "Already used",
    body:
      "This link has already been used to set a password. If that wasn't you, sign in below and contact an administrator. Otherwise, sign in directly.",
  },
};

export default async function SignupTokenPage({ params }: Props) {
  const { token } = await params;
  const branding = await getBranding();
  const peek = await peekSignupToken(token);

  const containerClass =
    "flex min-h-screen items-center justify-center bg-muted px-4";
  const cardClass =
    "w-full max-w-md rounded border border-border bg-card p-8 shadow-sm";

  if (!peek.ok) {
    const copy = REASON_COPY[peek.reason];
    return (
      <div className={containerClass}>
        <div className={cardClass}>
          <h1 className="text-2xl font-bold text-primary mb-2">
            {branding.companyName || "OpsHub"}
          </h1>
          <h2 className="text-lg font-semibold mb-2">{copy.title}</h2>
          <p className="text-sm text-muted-foreground mb-6">{copy.body}</p>
          <Link
            href="/login"
            className="inline-flex h-9 items-center rounded border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  const headlineCopy =
    peek.kind === "reset"
      ? "Reset your password"
      : "Set a password to finish setting up your account";
  return (
    <div className={containerClass}>
      <div className={cardClass}>
        <h1 className="text-2xl font-bold text-primary mb-2">
          {branding.companyName || "OpsHub"}
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {peek.kind === "reset" ? "Hi" : "Welcome"} {peek.userName} — {headlineCopy.toLowerCase()}.
          You&rsquo;ll sign in with{" "}
          <span className="font-mono text-foreground">{peek.userEmail}</span>.
        </p>
        <SignupForm token={token} kind={peek.kind} />
      </div>
    </div>
  );
}
