-- AlterTable: make hashedPassword optional for OAuth users
ALTER TABLE "User" ALTER COLUMN "hashedPassword" DROP NOT NULL;

-- AlterTable: add authProvider to track sign-in method
ALTER TABLE "User" ADD COLUMN "authProvider" TEXT NOT NULL DEFAULT 'credentials';

-- CreateTable: admin-managed allowlist of email domains for Google SSO
CREATE TABLE "AllowedDomain" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllowedDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AllowedDomain_domain_key" ON "AllowedDomain"("domain");
