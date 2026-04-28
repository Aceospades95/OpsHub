/**
 * Shared types for the email infrastructure.
 *
 * Kept in a separate file with no side effects so both server code and
 * template modules can import without dragging in the driver registry.
 */

/** A single rendered email ready to hand to a driver. */
export interface EmailMessage {
  /** Recipient(s). Accepts a single address or an array. */
  to: string | string[];
  /** CC recipient(s). Accepts a single address or an array. */
  cc?: string | string[];
  /** BCC recipient(s). Accepts a single address or an array. */
  bcc?: string | string[];
  /** Subject line */
  subject: string;
  /** HTML body */
  html: string;
  /** Plain-text body — optional but strongly recommended for deliverability */
  text?: string;
  /** Sender override. Defaults to EMAIL_FROM env var. */
  from?: string;
  /**
   * Reply-To override. Useful when the From address is a no-reply
   * mailbox and you want responses to land somewhere a human reads
   * (e.g. an ops@ alias).
   */
  replyTo?: string;
}

/** Result of a send attempt. */
export interface EmailSendResult {
  success: boolean;
  /** Provider-assigned message ID (if any) */
  messageId?: string;
  /** Error message when success=false */
  error?: string;
  /** Which driver handled this send */
  driver: string;
}

/**
 * Metadata attached when sending through the high-level sendEmail() API.
 * These fields land in EmailLog rows for audit and are not passed to the
 * underlying driver.
 */
export interface EmailAuditContext {
  /** Template key (if using a template) */
  templateKey?: string;
  /** Related entity type (e.g., "user", "task", "project") */
  entityType?: string;
  /** Related entity ID */
  entityId?: string;
}

/**
 * A driver is anything that knows how to actually deliver a message.
 * The LogDriver is the default for dev — it records the send in the
 * EmailLog table and returns success without touching any real provider.
 */
export interface EmailDriver {
  /** Unique name used in EmailLog.driver */
  name: string;
  /**
   * Attempt to deliver the message. Must not throw — any error should be
   * returned as success=false so the caller can log it consistently.
   */
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/**
 * Shape of an email template. Each template takes typed data and produces
 * a concrete message body. Templates return the body pieces, not the `to`
 * field — that's supplied by the caller at send time.
 */
export type EmailTemplate<TData> = (data: TData) => {
  subject: string;
  html: string;
  text: string;
};
