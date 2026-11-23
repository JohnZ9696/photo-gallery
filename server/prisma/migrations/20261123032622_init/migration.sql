-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('READY', 'DELETED', 'PURGED');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('STAGED', 'PUBLISHED', 'SUPERSEDED', 'FAILED', 'PURGED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "masterKey" TEXT,
    "masterWidth" INTEGER NOT NULL,
    "masterHeight" INTEGER NOT NULL,
    "masterBytes" INTEGER NOT NULL,
    "masterChecksum" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "nextVersion" INTEGER NOT NULL DEFAULT 2,
    "status" "PhotoStatus" NOT NULL DEFAULT 'READY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoVersion" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "paramsJson" TEXT NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'STAGED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "PhotoVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoVariant" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleanedAt" TIMESTAMP(3),

    CONSTRAINT "PhotoVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleanupJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "photoId" TEXT,
    "version" INTEGER,
    "storageKey" TEXT,
    "prefix" TEXT,
    "runAfter" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CleanupJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Photo_status_createdAt_idx" ON "Photo"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Photo_ownerId_createdAt_idx" ON "Photo"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "PhotoVersion_status_createdAt_idx" ON "PhotoVersion"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PhotoVersion_status_supersededAt_idx" ON "PhotoVersion"("status", "supersededAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoVersion_photoId_version_key" ON "PhotoVersion"("photoId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoVariant_storageKey_key" ON "PhotoVariant"("storageKey");

-- CreateIndex
CREATE INDEX "PhotoVariant_photoId_version_idx" ON "PhotoVariant"("photoId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoVariant_photoId_version_kind_key" ON "PhotoVariant"("photoId", "version", "kind");

-- CreateIndex
CREATE INDEX "CleanupJob_status_runAfter_idx" ON "CleanupJob"("status", "runAfter");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoVersion" ADD CONSTRAINT "PhotoVersion_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoVariant" ADD CONSTRAINT "PhotoVariant_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
