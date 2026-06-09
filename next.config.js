/** @type {import('next').NextConfig} */

// Baseline security headers applied to every response. See R11-F.
// CSP intentionally NOT set here — a strict CSP requires auditing
// every inline <script> / <style> in Next's hydration output and
// every third-party widget (the dashboard's react-grid-layout, the
// rich-text editor's tiptap module, the PDF embed iframes). We'll
// roll a Content-Security-Policy-Report-Only header in a follow-up
// once that audit is done.
const SECURITY_HEADERS = [
  // HSTS: 2-year max-age + includeSubDomains + preload eligibility.
  // Safe in production because every public deploy is HTTPS-only;
  // local dev (http://localhost:3000) doesn't honor HSTS so this
  // doesn't break the dev loop.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Block MIME sniffing — defense-in-depth against a misconfigured
  // upload route returning HTML for a /api/files/* response.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Block clickjacking. OpsHub never iframes its own pages — the
  // only iframes in the app point at user-supplied external URLs
  // (PDF / Google Forms / Jotform embeds), so DENY is safe.
  { key: "X-Frame-Options", value: "DENY" },
  // Don't leak full URLs to third parties when users click outbound
  // links. strict-origin-when-cross-origin still sends the origin
  // (so analytics on internal navigation works) but strips the path.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable browser APIs we don't use. Reduces the attack surface
  // an XSS could leverage if one ever lands.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // Allow the browser to pre-resolve DNS for outbound links (Lucide
  // icons hosted on jsdelivr, etc.). Off by default in some browsers.
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

module.exports = nextConfig;
