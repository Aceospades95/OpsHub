"use client";

import { forwardRef, useId, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", label, error, id, ...props }, ref) => {
    // Auto-generate a unique id (React useId is SSR-stable) instead of
    // deriving one from the label text — two fields labeled "Name" on
    // the same page used to collide and mis-wire their <label>s.
    const autoId = useId();
    const inputId = id || autoId;
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-foreground">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`flex h-10 w-full rounded border border-input bg-background px-3 py-2 text-sm
            placeholder:text-muted-foreground
            focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1
            disabled:cursor-not-allowed disabled:opacity-50
            ${error ? "border-destructive" : ""} ${className}`}
          {...props}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
