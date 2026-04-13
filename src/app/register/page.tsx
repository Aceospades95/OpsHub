import Link from "next/link";

/**
 * Registration is disabled — accounts are created by admins through the
 * Team > Admin panel. This page exists only so the route doesn't 404 if
 * someone types it directly.
 */
export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="w-full max-w-md rounded border border-border bg-card p-8 shadow-sm text-center">
        <h1 className="text-2xl font-bold text-primary mb-2">OpsHub</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Self-registration is not available. Your account will be created
          by an administrator.
        </p>
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
