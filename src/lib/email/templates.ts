/**
 * Email templates.
 *
 * Each template is a function that takes typed data and returns the three
 * pieces of an email body: subject, html, text. The outer sendEmail() API
 * looks up templates by key, calls them with the supplied data, and hands
 * the result to the active driver.
 *
 * Adding a new template:
 *   1. Write a new function below that returns { subject, html, text }
 *   2. Add it to the TEMPLATES map at the bottom with a unique key
 *   3. Call sendFromTemplate("your-template-key", data, { to: "..." })
 *
 * Keep templates plain TypeScript for now — we can introduce React Email
 * or MJML later without changing the call sites, since sendFromTemplate()
 * only cares that a template function produces the three strings.
 */

import type { EmailTemplate } from "./types";

// ─── Shared HTML scaffolding ───────────────────────────────────

/**
 * Wrap a piece of body HTML in a minimal responsive email shell.
 * This is deliberately simple — no heavy framework, just enough to keep
 * Gmail/Outlook from mangling the layout.
 */
function shell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1a1a;">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;padding:32px;">
    <h1 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111;">${escapeHtml(title)}</h1>
    <div style="font-size:14px;line-height:1.6;color:#333;">${bodyHtml}</div>
    <hr style="margin:32px 0 16px;border:none;border-top:1px solid #e5e5e5;" />
    <p style="margin:0;font-size:12px;color:#888;">Sent by OpsHub</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Templates ─────────────────────────────────────────────────

export interface WelcomeTemplateData {
  name: string;
  loginUrl: string;
}

const welcome: EmailTemplate<WelcomeTemplateData> = ({ name, loginUrl }) => {
  const subject = `Welcome to OpsHub, ${name}`;
  const html = shell(
    subject,
    `<p>Hi ${escapeHtml(name)},</p>
     <p>Your OpsHub account has been created. You can sign in at the link below.</p>
     <p><a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:10px 18px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px;">Sign in</a></p>
     <p>If you didn't expect this email you can ignore it.</p>`
  );
  const text = `Hi ${name},

Your OpsHub account has been created. Sign in at: ${loginUrl}

If you didn't expect this email you can ignore it.

— OpsHub`;
  return { subject, html, text };
};

export interface InviteTemplateData {
  /** Recipient's display name. */
  name: string;
  /** Absolute URL the recipient clicks to set their password. */
  signupUrl: string;
  /** Hours until the link stops working. */
  expiresInHours: number;
  /** "invite" for first-time setup, "reset" for password reset. The
   *  same template covers both with slightly different copy. */
  kind: "invite" | "reset";
  /** Display name of the admin who triggered this. Optional — used in
   *  the "{Admin} just invited you" intro line. */
  invitedByName?: string;
}

const invite: EmailTemplate<InviteTemplateData> = ({
  name,
  signupUrl,
  expiresInHours,
  kind,
  invitedByName,
}) => {
  const isReset = kind === "reset";
  const subject = isReset
    ? `Reset your OpsHub password`
    : `${invitedByName ? `${invitedByName} ` : ""}invited you to OpsHub`;
  const intro = isReset
    ? `<p>A password reset was requested for your OpsHub account. Click the button below to choose a new password.</p>`
    : `<p>${
        invitedByName
          ? `${escapeHtml(invitedByName)} invited you to OpsHub.`
          : "You've been invited to OpsHub."
      } Click the button below to set your password and sign in for the first time.</p>`;
  const html = shell(
    subject,
    `<p>Hi ${escapeHtml(name)},</p>
     ${intro}
     <p><a href="${escapeHtml(signupUrl)}" style="display:inline-block;padding:10px 18px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px;">${
       isReset ? "Reset password" : "Set password & sign in"
     }</a></p>
     <p style="color:#666;font-size:12px;">This link expires in ${expiresInHours} hour${expiresInHours === 1 ? "" : "s"} and can only be used once. If you didn't expect this email you can ignore it.</p>`
  );
  const text = `Hi ${name},

${
  isReset
    ? "A password reset was requested for your OpsHub account."
    : `${invitedByName ? `${invitedByName} invited you to OpsHub.` : "You've been invited to OpsHub."}`
}

${isReset ? "Reset your password" : "Set your password and sign in"} at:
${signupUrl}

This link expires in ${expiresInHours} hour${expiresInHours === 1 ? "" : "s"} and can only be used once. If you didn't expect this email you can ignore it.

— OpsHub`;
  return { subject, html, text };
};

export interface NotificationTemplateData {
  recipientName: string;
  /** Headline e.g. "You were assigned a task" */
  heading: string;
  /** Main body paragraph */
  body: string;
  /** Optional call-to-action button */
  cta?: { label: string; url: string };
}

const notification: EmailTemplate<NotificationTemplateData> = ({
  recipientName,
  heading,
  body,
  cta,
}) => {
  const subject = heading;
  const ctaHtml = cta
    ? `<p><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:10px 18px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px;">${escapeHtml(cta.label)}</a></p>`
    : "";
  const html = shell(
    heading,
    `<p>Hi ${escapeHtml(recipientName)},</p>
     <p>${escapeHtml(body)}</p>
     ${ctaHtml}`
  );
  const text = `Hi ${recipientName},

${body}

${cta ? `${cta.label}: ${cta.url}\n\n` : ""}— OpsHub`;
  return { subject, html, text };
};

export interface ReportTemplateData {
  recipientName: string;
  /** Report display name, e.g., "Contracts expiring soon" */
  reportName: string;
  /** One-line description shown under the heading */
  description: string;
  /** Summary line like "12 contracts expiring in the next 60 days" */
  summary: string;
  /**
   * Pre-rendered HTML body — usually the output of renderHtml(report) from
   * the reports module. We inject it raw so formatters don't have to think
   * about escaping. The caller is responsible for producing safe HTML.
   */
  htmlBody: string;
  /** Plain-text fallback matching the HTML body */
  textBody: string;
  /** Optional CTA (e.g., link to the live admin view) */
  cta?: { label: string; url: string };
}

const report: EmailTemplate<ReportTemplateData> = ({
  recipientName,
  reportName,
  description,
  htmlBody,
  textBody,
  cta,
}) => {
  const subject = `OpsHub report · ${reportName}`;
  const ctaHtml = cta
    ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:10px 18px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px;">${escapeHtml(cta.label)}</a></p>`
    : "";
  const html = shell(
    reportName,
    `<p style="margin:0 0 8px;">Hi ${escapeHtml(recipientName)},</p>
     <p style="margin:0 0 16px;color:#555;">${escapeHtml(description)}</p>
     ${htmlBody}
     ${ctaHtml}`
  );
  const text = `Hi ${recipientName},

${reportName}
${description}

${textBody}

${cta ? `${cta.label}: ${cta.url}\n\n` : ""}— OpsHub`;
  return { subject, html, text };
};

export interface WorkflowDigestTemplateData {
  recipientName: string;
  /** Stuck workflow steps the digest is reporting. */
  stuckItems: Array<{
    templateName: string;
    subjectName: string;
    stepName: string;
    daysWaiting: number;
    instanceUrl: string;
  }>;
  /** Quotes that are open past their valid_until date, or expiring soon. */
  expiringQuotes: Array<{
    quoteNumber: string;
    title: string;
    clientName: string;
    daysUntilExpiry: number; // negative = already expired
    quoteUrl: string;
  }>;
  /** Absolute URL to the analytics page for the "see all" CTA. */
  workflowAnalyticsUrl: string;
}

const workflowDigest: EmailTemplate<WorkflowDigestTemplateData> = ({
  recipientName,
  stuckItems,
  expiringQuotes,
  workflowAnalyticsUrl,
}) => {
  const subject = `OpsHub digest · ${stuckItems.length} stuck workflow${stuckItems.length === 1 ? "" : "s"}, ${expiringQuotes.length} expiring quote${expiringQuotes.length === 1 ? "" : "s"}`;

  const stuckHtml = stuckItems.length
    ? `<h2 style="margin:24px 0 8px;font-size:14px;font-weight:600;">Stuck workflow steps</h2>
       <ul style="margin:0 0 8px;padding-left:18px;">
         ${stuckItems
           .map(
             (s) =>
               `<li style="margin-bottom:6px;">
                  <a href="${escapeHtml(s.instanceUrl)}" style="color:#1a1a1a;text-decoration:underline;">
                    ${escapeHtml(s.templateName)} — ${escapeHtml(s.subjectName)}
                  </a>:
                  ${escapeHtml(s.stepName)}
                  <span style="color:#888;">(${s.daysWaiting} day${s.daysWaiting === 1 ? "" : "s"} waiting)</span>
                </li>`
           )
           .join("")}
       </ul>`
    : `<p style="color:#555;margin:8px 0;">No stuck workflow steps. ✓</p>`;

  const quotesHtml = expiringQuotes.length
    ? `<h2 style="margin:24px 0 8px;font-size:14px;font-weight:600;">Quotes expiring or expired</h2>
       <ul style="margin:0;padding-left:18px;">
         ${expiringQuotes
           .map((q) => {
             const tag =
               q.daysUntilExpiry < 0
                 ? `expired ${-q.daysUntilExpiry}d ago`
                 : `${q.daysUntilExpiry}d to expiry`;
             return `<li style="margin-bottom:6px;">
                       <a href="${escapeHtml(q.quoteUrl)}" style="color:#1a1a1a;text-decoration:underline;">
                         ${escapeHtml(q.quoteNumber)} — ${escapeHtml(q.title)}
                       </a>
                       <span style="color:#888;"> for ${escapeHtml(q.clientName)} (${escapeHtml(tag)})</span>
                     </li>`;
           })
           .join("")}
       </ul>`
    : `<p style="color:#555;margin:8px 0;">No quotes expiring soon. ✓</p>`;

  const html = shell(
    "Daily ops digest",
    `<p>Hi ${escapeHtml(recipientName)},</p>
     <p style="color:#555;">Here's what needs attention today.</p>
     ${stuckHtml}
     ${quotesHtml}
     <p style="margin:24px 0 0;">
       <a href="${escapeHtml(workflowAnalyticsUrl)}" style="display:inline-block;padding:10px 18px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px;">Open workflow analytics</a>
     </p>`
  );

  const text = `Hi ${recipientName},

Here's what needs attention today.

Stuck workflow steps (${stuckItems.length}):
${
  stuckItems
    .map(
      (s) =>
        `• ${s.templateName} — ${s.subjectName}: ${s.stepName} (${s.daysWaiting}d waiting)\n  ${s.instanceUrl}`
    )
    .join("\n") || "  None ✓"
}

Quotes expiring or expired (${expiringQuotes.length}):
${
  expiringQuotes
    .map((q) => {
      const tag =
        q.daysUntilExpiry < 0
          ? `expired ${-q.daysUntilExpiry}d ago`
          : `${q.daysUntilExpiry}d to expiry`;
      return `• ${q.quoteNumber} — ${q.title} for ${q.clientName} (${tag})\n  ${q.quoteUrl}`;
    })
    .join("\n") || "  None ✓"
}

Open analytics: ${workflowAnalyticsUrl}

— OpsHub`;

  return { subject, html, text };
};

export interface TestTemplateData {
  to: string;
}

const test: EmailTemplate<TestTemplateData> = ({ to }) => {
  const subject = "OpsHub email test";
  const html = shell(
    subject,
    `<p>This is a test message sent to <strong>${escapeHtml(to)}</strong> at ${new Date().toISOString()}.</p>
     <p>If you're seeing this, the email pipeline is wired up correctly.</p>`
  );
  const text = `This is a test message sent to ${to} at ${new Date().toISOString()}.

If you're seeing this, the email pipeline is wired up correctly.

— OpsHub`;
  return { subject, html, text };
};

export interface QuoteSentTemplateData {
  /** Company display name ("Wynndalco"). */
  companyName: string;
  quoteNumber: string;
  quoteTitle: string;
  /** Pre-formatted total, e.g. "$12,500.00". */
  totalFormatted: string;
  /** Pre-formatted expiry, e.g. "Aug 15, 2026". Null = no expiry. */
  validUntilFormatted: string | null;
  /** Optional personal note from the sender, shown above the summary. */
  message: string | null;
  /** Sender display name for the sign-off. */
  senderName: string;
  /** Tokenized public PDF download link. */
  downloadUrl: string;
}

const quoteSent: EmailTemplate<QuoteSentTemplateData> = (data) => {
  const subject = `${data.companyName} — Quote ${data.quoteNumber}: ${data.quoteTitle}`;
  const summaryRows = [
    `<tr><td style="padding:4px 12px 4px 0;color:#888;">Quote</td><td style="padding:4px 0;">${escapeHtml(data.quoteNumber)}</td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:#888;">Total</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(data.totalFormatted)}</td></tr>`,
    data.validUntilFormatted
      ? `<tr><td style="padding:4px 12px 4px 0;color:#888;">Valid until</td><td style="padding:4px 0;">${escapeHtml(data.validUntilFormatted)}</td></tr>`
      : "",
  ].join("");
  const html = shell(
    `Quote from ${data.companyName}`,
    `${data.message ? `<p style="white-space:pre-wrap;">${escapeHtml(data.message)}</p>` : ""}
     <p>Please find our quote <strong>${escapeHtml(data.quoteTitle)}</strong> at the link below.</p>
     <table style="font-size:14px;border-collapse:collapse;margin:8px 0 16px;">${summaryRows}</table>
     <p><a href="${data.downloadUrl}" style="display:inline-block;background:#166534;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">Download the quote (PDF)</a></p>
     <p style="color:#888;font-size:12px;">The link opens a PDF copy of the quote — no sign-in needed.</p>
     <p>Best regards,<br/>${escapeHtml(data.senderName)}<br/>${escapeHtml(data.companyName)}</p>`
  );
  const text = `${data.message ? data.message + "\n\n" : ""}Please find our quote "${data.quoteTitle}" at the link below.

Quote: ${data.quoteNumber}
Total: ${data.totalFormatted}${data.validUntilFormatted ? `\nValid until: ${data.validUntilFormatted}` : ""}

Download the quote (PDF): ${data.downloadUrl}

Best regards,
${data.senderName}
${data.companyName}`;
  return { subject, html, text };
};

// ─── Template registry ─────────────────────────────────────────

/**
 * Keys are what callers pass to sendFromTemplate(). TypeScript will
 * infer the data shape from the key, so the compiler catches mismatches.
 *
 * The registry uses `unknown` as the template data type since each template
 * has a different data shape. The type-safe public API is sendFromTemplate()
 * which enforces the correct shape via TemplateDataMap.
 */
export const TEMPLATES: Record<string, EmailTemplate<unknown>> = {
  welcome: welcome as EmailTemplate<unknown>,
  invite: invite as EmailTemplate<unknown>,
  notification: notification as EmailTemplate<unknown>,
  report: report as EmailTemplate<unknown>,
  test: test as EmailTemplate<unknown>,
  "workflow-digest": workflowDigest as EmailTemplate<unknown>,
  "quote-sent": quoteSent as EmailTemplate<unknown>,
};

// Template data map for type-safe calls
export interface TemplateDataMap {
  welcome: WelcomeTemplateData;
  invite: InviteTemplateData;
  notification: NotificationTemplateData;
  report: ReportTemplateData;
  test: TestTemplateData;
  "workflow-digest": WorkflowDigestTemplateData;
  "quote-sent": QuoteSentTemplateData;
}

export type TemplateKey = keyof TemplateDataMap;
