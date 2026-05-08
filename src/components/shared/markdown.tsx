import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/**
 * Render user-authored markdown safely.
 *
 * `rehype-sanitize` strips any tag / attribute that isn't on the
 * default safe list — no scripts, no inline event handlers, no
 * `javascript:` URLs. `remark-gfm` enables tables, strikethrough,
 * task lists, and autolinks (the GitHub-flavored extensions our
 * users already type by default).
 *
 * Round-4 QA flagged that intranet content was rendering as raw
 * markdown source (`# Heading` displayed verbatim instead of a
 * styled H1). Wiring this on the Content card fixes that. Tailwind
 * `prose` classes scope the typography styles so we don't ship
 * global element styling.
 */
// Element-level Tailwind via arbitrary variants — keeps us off the
// @tailwindcss/typography plugin (one less dep) while still styling
// every common markdown construct. Whitespace inside the className
// string is fine; Tailwind's JIT picks each variant up.
const PROSE = [
  "text-sm leading-relaxed",
  "[&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2",
  "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2",
  "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5",
  "[&_p]:my-2",
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2",
  "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2",
  "[&_li]:my-0.5",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono",
  "[&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground",
  "[&_table]:border [&_table]:border-border [&_table]:my-2",
  "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted/40",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
  "[&_hr]:my-4 [&_hr]:border-border",
].join(" ");

export function Markdown({ source }: { source: string }) {
  return (
    <div className={PROSE}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
