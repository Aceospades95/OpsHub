/**
 * SesDriver — AWS SES (v2 API) email driver.
 *
 * Mirrors the shape of s3-driver.ts: pure SDK code, no logic about audit
 * logging or templates (those live one layer up in index.ts and
 * templates.ts). Credentials resolve via the AWS SDK's default provider
 * chain — IAM roles in production, ~/.aws/credentials or env vars
 * locally. We deliberately do NOT read AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
 * here so the SDK's default chain stays in charge.
 *
 * Required env:
 *   SES_REGION — AWS region (e.g. us-east-1)
 *
 * Optional env:
 *   EMAIL_FROM — default sender. Resolved upstream in drivers.ts; this
 *                driver only sees a fully-resolved `from` on the message.
 *
 * SES sandbox note: new SES accounts can only deliver to verified
 * addresses until you request production access. The `error` returned on
 * a sandbox failure is surfaced verbatim in EmailLog so you can see why a
 * given send was rejected.
 */

import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";
import type { EmailDriver, EmailMessage, EmailSendResult } from "./types";

let cachedClient: SESv2Client | null = null;

function getClient(): SESv2Client {
  if (cachedClient) return cachedClient;
  const region = process.env.SES_REGION;
  if (!region) throw new Error("SES_REGION is not set");
  cachedClient = new SESv2Client({ region });
  return cachedClient;
}

export const sesDriver: EmailDriver = {
  name: "ses",

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const client = getClient();
      const toAddresses = toList(message.to);
      const ccAddresses = toList(message.cc);
      const bccAddresses = toList(message.bcc);
      if (!message.from) {
        // sendEmail() in index.ts always resolves a `from` before calling
        // the driver, so this is just a safety net.
        return {
          success: false,
          driver: "ses",
          error: "SES driver requires a `from` address",
        };
      }

      const input: SendEmailCommandInput = {
        FromEmailAddress: message.from,
        Destination: {
          ToAddresses: toAddresses,
          ...(ccAddresses.length > 0 ? { CcAddresses: ccAddresses } : {}),
          ...(bccAddresses.length > 0 ? { BccAddresses: bccAddresses } : {}),
        },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: message.html, Charset: "UTF-8" },
              ...(message.text
                ? { Text: { Data: message.text, Charset: "UTF-8" } }
                : {}),
            },
          },
        },
        ...(message.replyTo ? { ReplyToAddresses: [message.replyTo] } : {}),
      };

      const result = await client.send(new SendEmailCommand(input));
      return {
        success: true,
        driver: "ses",
        messageId: result.MessageId,
      };
    } catch (err) {
      return {
        success: false,
        driver: "ses",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

function toList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((v) => v && v.trim().length > 0);
  return value.trim() ? [value] : [];
}
