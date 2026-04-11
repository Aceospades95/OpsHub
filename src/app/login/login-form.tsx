"use client";

import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loginAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface Props {
  companyName: string;
  companyLogoUrl: string | null;
}

export function LoginForm({ companyName, companyLogoUrl }: Props) {
  const [state, formAction] = useFormState(loginAction, null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setPending(false);
    if (state?.success) {
      router.push("/dashboard");
    }
  }, [state, router]);

  return (
    <div className="w-full max-w-md rounded border border-border bg-card p-6 sm:p-8 shadow-sm relative z-10">
      <div className="mb-8 text-center">
        {companyLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={companyLogoUrl}
            alt={companyName}
            className="h-12 w-auto mx-auto mb-2 max-w-[240px] object-contain"
          />
        ) : (
          <h1 className="text-2xl font-bold text-primary">{companyName}</h1>
        )}
        <p className="mt-1 text-sm text-muted-foreground">Sign in to your account</p>
      </div>

      {state?.error && (
        <div className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      <form action={formAction} onSubmit={() => setPending(true)} className="space-y-4">
        <Input
          name="email"
          type="email"
          label="Email"
          placeholder="you@company.com"
          required
          error={state?.fieldErrors?.email?.[0]}
        />
        <Input
          name="password"
          type="password"
          label="Password"
          placeholder="Enter your password"
          required
          error={state?.fieldErrors?.password?.[0]}
        />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in..." : "Sign In"}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="text-primary hover:underline">
          Register
        </Link>
      </p>
    </div>
  );
}
