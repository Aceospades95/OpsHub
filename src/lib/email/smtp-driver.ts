/**
 * SmtpDriver — generic SMTP email driver via nodemailer.
 *
 * Mirrors the shape of ses-driver.ts: pure SDK code, no logic about audit
 * logging or templates (those live one layer up in index.ts and
 * templates.ts). Wynndalco sends transactional email through Google
 * Workspace SMTP using an app password, and the Jenkins reporting
 * pipeline uses the same path — this driver keeps OpsHub on the same
 * infrastructure.
 *
 * Required env:
 *   SMTP_HOST     — SMTP server hostname (e.g. smtp.gmail.com)
 *   SMTP_PORT     — port number (e.g. 465 for TLS, 587 for STARTTLS)
 *   SMTP_SECURE   — "true" for implicit TLS (port 465), "false" for
 *                   STARTTLS (port 587)
 *   SMTP_USER     — SMTP auth username, also the sender mailbox
 *   SMTP_PASSWORD — SMTP auth password (Gmail app password, etc.)
 *
 * Note: EMAIL_FROM is resolved upstream in drivers.ts and arrives on the
 * message; for Gmail the envelope sender must match SMTP_USER, so set
 * EMAIL_FROM to the same address.
 */

import nodemailer, { type Transporter } from "nodemailer";
import type { EmailDriver, EmailMessage, EmailSendResult } from "./types";

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const portRaw = process.env.SMTP_PORT;
  const secureRaw = process.env.SMTP_SECURE;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host) throw new Error("SMTP_HOST is not set");
  if (!portRaw) throw new Error("SMTP_PORT is not set");
  if (!user) throw new Error("SMTP_USER is not set");
  if (!pass) throw new Error("SMTP_PASSWORD is not set");

  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port)) {
    throw new Error(`SMTP_PORT is not a valid number: ${portRaw}`);
  }

  // Default to true when SMTP_SECURE is unset, since 465 (the most common
  // submission port for hosted providers) requires implicit TLS.
  const secure = secureRaw === undefined ? true : secureRaw.toLowerCase() === "true";

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return cachedTransporter;
}

export const smtpDriver: EmailDriver = {
  name: "smtp",

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const transporter = getTransporter();
      if (!message.from) {
        // sendEmail() in index.ts always resolves a `from` before calling
        // the driver, so this is just a safety net.
        return {
          success: false,
          driver: "smtp",
          error: "SMTP driver requires a `from` address",
        };
      }

      const info = await transporter.sendMail({
        from: message.from,
        to: message.to,
        ...(message.cc ? { cc: message.cc } : {}),
        ...(message.bcc ? { bcc: message.bcc } : {}),
        subject: message.subject,
        html: message.html,
        ...(message.text ? { text: message.text } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      });

      return {
        success: true,
        driver: "smtp",
        messageId: info.messageId,
      };
    } catch (err) {
      return {
        success: false,
        driver: "smtp",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
