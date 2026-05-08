import { PlatformShell } from "@/components/layout/platform-shell";

/**
 * The shell (sidebar / header / palette / RSC healing) lives in
 * src/components/layout/platform-shell.tsx so the global 404 page
 * (src/app/not-found.tsx) can reuse it without duplicating the
 * data-fetch logic. See round-9 P1-R9-A.
 */
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PlatformShell>{children}</PlatformShell>;
}
