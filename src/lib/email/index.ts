/**
 * Email infrastructure — public API.
 *
 * This is the single entry point other features should use when they need
 * to send email. It handles:
 *   - Resolving the active driver from env config
 *   - Running the message through the driver
 *   - Logging every send attempt to the EmailLog table (even failures)
 *   - Returning a structured result so callers can handle errors
 *
 * Example usage:
 *
 *   import { sendFromTemplate } from "@/lib/email";
 *
 *   await sendFromTemplate("welcome", {
 *     name: user.name,
 *     loginUrl: "https://app.example.com/login",
 *   }, {
 *     to: user.email,
 *     entityType: "user",
 *     entityId: user.id,
 *   });
 *
 * In development the default "log" driver doesn't actually send — it just
 * writes a row to EmailLog and logs to console. To enable real sending,
 * set EMAIL_DRIVER=resend (or another registered driver) and supply the
 * necessary API key in env.
 */

import { db } from "@/lib/db";
import { getActiveDriver, getDefaultFrom } from "./drivers";
import type { EmailAuditContext, EmailMessage, EmailSendResult } from "./types";
import { TEMPLATES, type TemplateDataMap, type TemplateKey } from "./templates";

// Re-export types so consumers can import everything from @/lib/email
export type { EmailMessage, EmailSendResult, EmailAuditContext } from "./types";
export type { TemplateKey, TemplateDataMap } from "./templates";

/**
 * Send a pre-built email message. Most callers should prefer
 * sendFromTemplate() which handles rendering. Use this directly only
 * when you need to send ad-hoc content (e.g., a forwarded message).
 */
export async function sendEmail(
  message: EmailMessage,
  audit: EmailAuditContext = {}
): Promise<EmailSendResult> {
  const driver = getActiveDriver();
  const toList = Array.isArray(message.to) ? message.to : [message.to];

  // Resolve `from` inside the try so a missing EMAIL_FROM under a real
  // driver (which throws from getDefaultFrom) lands as a clean
  // success:false / EmailLog row rather than crashing the calling
  // mutation.
  let from = "";
  let result: EmailSendResult;
  try {
    from = message.from || getDefaultFrom();
    const normalized: EmailMessage = { ...message, from };
    result = await driver.send(normalized);
  } catch (err) {
    // Drivers are supposed to catch their own errors and return success:false,
    // but if one throws we still want to log the failure rather than crash
    // the calling mutation.
    result = {
      success: false,
      driver: driver.name,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Record every attempt, success or failure, for audit and debugging.
  // Swallow logging errors so a DB write failure doesn't bubble up and
  // mask the actual send result.
  try {
    await db.emailLog.create({
      data: {
        toAddresses: toList.join(", "),
        fromAddress: from,
        subject: message.subject,
        bodyHtml: message.html,
        bodyText: message.text || null,
        driver: result.driver,
        status: result.success ? "sent" : "failed",
        messageId: result.messageId || null,
        error: result.error || null,
        templateKey: audit.templateKey || null,
        entityType: audit.entityType || null,
        entityId: audit.entityId || null,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[email] Failed to write EmailLog entry", err);
  }

  return result;
}

/**
 * Render a template and send the result. This is the preferred API —
 * callers pass the template key and typed data, and everything else
 * is handled for them.
 */
export async function sendFromTemplate<K extends TemplateKey>(
  key: K,
  data: TemplateDataMap[K],
  options: {
    to: string | string[];
    from?: string;
    replyTo?: string;
    entityType?: string;
    entityId?: string;
  }
): Promise<EmailSendResult> {
  const template = TEMPLATES[key];
  if (!template) {
    return {
      success: false,
      driver: "none",
      error: `Unknown template key: ${key}`,
    };
  }

  const rendered = template(data);

  return sendEmail(
    {
      to: options.to,
      from: options.from,
      replyTo: options.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    },
    {
      templateKey: key,
      entityType: options.entityType,
      entityId: options.entityId,
    }
  );
}
