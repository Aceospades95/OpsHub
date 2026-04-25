/**
 * S3Driver — object-storage-backed driver for AWS S3 (and S3-compatible
 * services like MinIO and LocalStack via S3_ENDPOINT).
 *
 * Credentials are resolved by the AWS SDK's default credential provider
 * chain — IAM roles (ECS task role, EC2 instance profile, IRSA) in
 * production, environment variables or shared config (~/.aws/credentials)
 * locally. We deliberately do NOT read AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
 * here so the SDK's default chain stays in charge.
 *
 * Required env:
 *   S3_BUCKET   — bucket name
 *   S3_REGION   — AWS region (e.g. us-east-1)
 *
 * Optional env:
 *   S3_ENDPOINT — override endpoint URL for S3-compatible services. When
 *                 set, path-style addressing is used so the driver works
 *                 against LocalStack and MinIO out of the box.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as presignGetObject } from "@aws-sdk/s3-request-presigner";
import type {
  StorageDriver,
  StoragePutInput,
  StoragePutResult,
  SignedUrlOptions,
} from "./types";

let cachedClient: S3Client | null = null;
let cachedBucket: string | null = null;

function getClient(): { client: S3Client; bucket: string } {
  if (cachedClient && cachedBucket) {
    return { client: cachedClient, bucket: cachedBucket };
  }

  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION;
  if (!bucket) throw new Error("S3_BUCKET is not set");
  if (!region) throw new Error("S3_REGION is not set");

  const endpoint = process.env.S3_ENDPOINT;
  cachedClient = new S3Client({
    region,
    ...(endpoint
      ? { endpoint, forcePathStyle: true }
      : {}),
  });
  cachedBucket = bucket;
  return { client: cachedClient, bucket };
}

/** Async iterables (S3 GetObject Body) → Buffer. */
async function streamToBuffer(stream: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export const s3Driver: StorageDriver = {
  name: "s3",

  async put({ key, content, contentType }: StoragePutInput): Promise<StoragePutResult> {
    const { client, bucket } = getClient();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
      })
    );
    return { key, size: content.length };
  },

  async get(key: string): Promise<Buffer> {
    const { client, bucket } = getClient();
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    if (!result.Body) throw new Error(`S3 object ${key} has no body`);
    return streamToBuffer(result.Body);
  },

  async delete(key: string): Promise<void> {
    const { client, bucket } = getClient();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },

  async exists(key: string): Promise<boolean> {
    const { client, bucket } = getClient();
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (err: unknown) {
      const code = (err as { $metadata?: { httpStatusCode?: number }; name?: string })
        ?.$metadata?.httpStatusCode;
      if (code === 404) return false;
      const name = (err as { name?: string })?.name;
      if (name === "NotFound" || name === "NoSuchKey") return false;
      throw err;
    }
  },

  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const { client, bucket } = getClient();
    const encodedFilename = encodeURIComponent(options.filename);
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentType: options.contentType,
      ResponseContentDisposition: `${options.disposition}; filename*=UTF-8''${encodedFilename}`,
    });
    return presignGetObject(client, command, { expiresIn: options.expiresIn });
  },
};
