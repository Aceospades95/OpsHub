/**
 * LogDriver — the safe-by-default email driver.
 *
 * This driver does NOT actually send any email. It simply returns success
 * and lets the outer sendEmail() layer record the attempt in the EmailLog
 * table. This is the default in development and for any environment where
 * no real provider is configured, so calling sendEmail() is always safe.
 *
 * Console output is intentional in dev so you can see what would have been
 * sent without opening the DB.
 */

import type { EmailDriver, EmailMessage, EmailSendResult } from "./types";

export const logDriver: EmailDriver = {
  name: "log",
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const recipients = Array.isArray(message.to) ? message.to.join(", ") : message.to;
    // eslint-disable-next-line no-console
    console.info(
      `[email:log] Would send to=${recipients} subject="${message.subject}"`
    );
    return {
      success: true,
      driver: "log",
      messageId: `log-${Date.now()}`,
    };
  },
};
