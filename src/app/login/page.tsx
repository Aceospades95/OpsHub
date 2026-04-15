import { getBranding } from "@/lib/branding";
import { LoginForm } from "./login-form";

/**
 * Login page — server component so we can fetch branding (company name,
 * logo, background image) before rendering. The form interaction lives
 * in LoginForm as a client component.
 *
 * The background image is rendered behind a semi-transparent overlay so
 * the card stays readable even with photographic backgrounds.
 */
export default async function LoginPage() {
  const branding = await getBranding();
  const companyName = branding.companyName || "OpsHub";
  const googleEnabled = !!(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );

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
      />
    </div>
  );
}
