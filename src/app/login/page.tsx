import { getBranding } from "@/lib/branding";
import { LoginForm } from "./login-form";

/**
 * Friendly messages for the `?error=…` codes that the Google sign-in
 * helper surfaces (see src/lib/auth-google-signin.ts). Anything we
 * don't recognize (including NextAuth's default codes like
 * "AccessDenied", "OAuthSignin", etc.) falls through to a generic
 * "Sign-in failed" so we don't leak provider internals.
 */
const ERROR_MESSAGES: Record<string, string> = {
  EmailNotVerified:
    "Your Google account hasn't verified its email address yet. Verify the address with Google, then try again.",
  Disabled:
    "This account has been disabled. Contact an administrator if you believe this is a mistake.",
  DomainNotAllowed:
    "Your email domain is not on the allowed list for this OpsHub instance. Contact an administrator to request access.",
  DuplicateEmail:
    "There's a conflict on your account that an administrator needs to resolve. Please contact your IT lead.",
  NoEmail:
    "Google did not return an email address for your account. Please try a different sign-in method.",
  InvalidEmail:
    "Could not parse your email address. Please contact an administrator.",
};

interface Props {
  searchParams: Promise<{ error?: string | string[]; email?: string | string[] }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const branding = await getBranding();
  const companyName = branding.companyName || "OpsHub";
  const googleEnabled = !!(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );

  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const initialError = errorCode
    ? ERROR_MESSAGES[errorCode] ?? "Sign-in failed. Please try again."
    : null;

  // Optional `?email=` query param — we route here from the
  // /signup/[token] page after a successful password set so the user
  // doesn't have to re-type their email.
  const emailParam = Array.isArray(params.email) ? params.email[0] : params.email;
  const initialEmail =
    emailParam && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailParam)
      ? emailParam
      : undefined;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-muted px-4">
      {branding.backgroundImageUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={branding.backgroundImageUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Dark overlay for readability of the login card */}
          <div className="absolute inset-0 bg-background/70" aria-hidden="true" />
        </>
      )}
      <LoginForm
        companyName={companyName}
        companyLogoUrl={branding.companyLogoUrl}
        googleEnabled={googleEnabled}
        initialError={initialError}
        initialEmail={initialEmail}
      />
    </div>
  );
}
