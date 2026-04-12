import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { getThemeSettings } from "@/actions/theme";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "OpsHub",
  description: "Internal operations platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const themeSettings = await getThemeSettings();

  return (
    <html lang="en">
      <body>
        <ThemeProvider themeSettings={themeSettings}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
