-- One-time invite / password-reset token, replacing the
-- "admin types a plaintext password into the form" flow.
-- Raw tokens are never stored — only their SHA-256 hash.

-- CreateTable
CREATE TABLE "SignupToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'invite',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupToken_pkey" PRIMARY KEY ("id")
);

-- One token per user — issuing a new one replaces the old.
CREATE UNIQUE INDEX "SignupToken_userId_key" ON "SignupToken"("userId");

-- Lookup by token-hash on the validate path.
CREATE UNIQUE INDEX "SignupToken_tokenHash_key" ON "SignupToken"("tokenHash");

-- Cleanup scans (expired tokens, used-but-not-pruned tokens).
CREATE INDEX "SignupToken_expiresAt_idx" ON "SignupToken"("expiresAt");
CREATE INDEX "SignupToken_usedAt_idx" ON "SignupToken"("usedAt");

-- AddForeignKey
ALTER TABLE "SignupToken" ADD CONSTRAINT "SignupToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
