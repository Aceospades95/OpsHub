import type { Config } from "tailwindcss";

/**
 * Color tokens are defined against the RGB-triplet vars
 * (--{token}-rgb, set in globals.css and kept in sync with admin
 * themes by ThemeProvider) so Tailwind's <alpha-value> placeholder
 * works. With the previous plain `var(--x)` hex strings, every
 * opacity-modified utility (bg-primary/10, text-muted-foreground/70,
 * border-destructive/50, …) silently compiled to nothing.
 */
function token(name: string) {
  return `rgb(var(--${name}-rgb) / <alpha-value>)`;
}

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: token("background"),
        foreground: token("foreground"),
        primary: {
          DEFAULT: token("primary"),
          foreground: token("primary-foreground"),
        },
        secondary: {
          DEFAULT: token("secondary"),
          foreground: token("secondary-foreground"),
        },
        accent: {
          DEFAULT: token("accent"),
        },
        muted: {
          DEFAULT: token("muted"),
          foreground: token("muted-foreground"),
        },
        destructive: {
          DEFAULT: token("destructive"),
        },
        success: {
          DEFAULT: token("success"),
        },
        warning: {
          DEFAULT: token("warning"),
        },
        card: {
          DEFAULT: token("card"),
          foreground: token("card-foreground"),
        },
        border: token("border"),
        input: token("input"),
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
