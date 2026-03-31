"use client";

import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { registerAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function RegisterPage() {
  const [state, formAction] = useFormState(registerAction, null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setPending(false);
    if (state?.success) {
      router.push("/dashboard");
    }
  }, [state, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="w-full max-w-md rounded border border-border bg-card p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-primary">OpsHub</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create your account</p>
        </div>

        {state?.error && (
          <div className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">
            {state.error}
          </div>
        )}

        <form action={formAction} onSubmit={() => setPending(true)} className="space-y-4">
          <Input
            name="name"
            label="Full Name"
            placeholder="John Doe"
            required
            error={state?.fieldErrors?.name?.[0]}
          />
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
            placeholder="Min 6 characters"
            required
            error={state?.fieldErrors?.password?.[0]}
          />
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating account..." : "Create Account"}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
