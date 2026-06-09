"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { setPasswordFromToken } from "@/actions/admin";

interface Props {
  token: string;
  kind: "invite" | "reset";
}

/** Crude strength score 0–4. Doesn't pretend to replace zxcvbn — it
 *  just nudges the user toward a longer / mixed-character password. */
function passwordStrength(value: string): {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
} {
  if (value.length === 0) return { score: 0, label: "" };
  if (value.length < 8) return { score: 1, label: "Too short" };
  let score = 1;
  if (value.length >= 12) score++;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
  const labels = ["", "Weak", "Okay", "Good", "Strong"] as const;
  return { score: Math.min(score, 4) as 0 | 1 | 2 | 3 | 4, label: labels[score] };
}

export function SignupForm({ token, kind }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const strength = useMemo(() => passwordStrength(password), [password]);
  const mismatch = confirm.length > 0 && password !== confirm;

  useEffect(() => {
    if (!done) return;
    // Auto-redirect to login after 1.5s so the success state is
    // visible briefly. The user can also click through directly.
    const timer = setTimeout(() => {
      router.push(`/login?email=${encodeURIComponent(done.email)}`);
    }, 1500);
    return () => clearTimeout(timer);
  }, [done, router]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    const fd = new FormData();
    fd.set("token", token);
    fd.set("password", password);
    fd.set("confirm", confirm);
    startTransition(async () => {
      const res = await setPasswordFromToken(null, fd);
      if (!("success" in res) || !res.success) {
        setError("error" in res ? res.error : "Could not set password");
        return;
      }
      setDone({ email: res.email });
    });
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded border border-success/40 bg-success/10 p-3 text-sm">
          <p className="font-medium">Password set</p>
          <p className="text-xs text-muted-foreground mt-1">
            Redirecting you to the sign-in page…
          </p>
        </div>
        <Link
          href={`/login?email=${encodeURIComponent(done.email)}`}
          className="inline-flex h-9 items-center rounded border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Sign in now
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium" htmlFor="password">
          New password *
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background"
        />
        {password.length > 0 && (
          <div className="mt-2 space-y-1">
            <div
              className="h-1 rounded bg-muted overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={4}
              aria-valuenow={strength.score}
              aria-label={`Password strength: ${strength.label}`}
            >
              <div
                className={`h-full transition-all ${
                  strength.score === 1
                    ? "bg-destructive w-1/4"
                    : strength.score === 2
                    ? "bg-warning w-2/4"
                    : strength.score === 3
                    ? "bg-success/80 w-3/4"
                    : strength.score === 4
                    ? "bg-success w-full"
                    : "w-0"
                }`}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {strength.label}. Use 12+ characters with a mix of cases, numbers, and symbols for best protection.
            </p>
          </div>
        )}
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="confirm">
          Confirm password *
        </label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={mismatch || undefined}
          className={`w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background ${
            mismatch ? "border-destructive" : "border-input"
          }`}
        />
        {mismatch && (
          <p className="mt-1 text-xs text-destructive" role="alert">
            Passwords don&rsquo;t match
          </p>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-9 items-center rounded bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
      >
        {pending
          ? "Setting password…"
          : kind === "reset"
          ? "Reset password"
          : "Set password & continue"}
      </button>
    </form>
  );
}
