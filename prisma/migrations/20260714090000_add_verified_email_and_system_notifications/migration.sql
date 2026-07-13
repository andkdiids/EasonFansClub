-- Add broadcast-style system notifications without writing one row per user.
CREATE TABLE IF NOT EXISTS "SystemNotification" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "link" TEXT,
  "type" TEXT NOT NULL DEFAULT 'SYSTEM',
  "isPublished" BOOLEAN NOT NULL DEFAULT true,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  CONSTRAINT "SystemNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SystemNotification_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "SystemNotificationRead" (
  "id" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notificationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "SystemNotificationRead_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SystemNotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "SystemNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SystemNotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SystemNotification_isPublished_publishedAt_idx" ON "SystemNotification"("isPublished", "publishedAt");
CREATE INDEX IF NOT EXISTS "SystemNotification_createdById_createdAt_idx" ON "SystemNotification"("createdById", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SystemNotificationRead_notificationId_userId_key" ON "SystemNotificationRead"("notificationId", "userId");
CREATE INDEX IF NOT EXISTS "SystemNotificationRead_userId_readAt_idx" ON "SystemNotificationRead"("userId", "readAt");
CREATE INDEX IF NOT EXISTS "SystemNotificationRead_notificationId_idx" ON "SystemNotificationRead"("notificationId");

-- Optional contact fields remain nullable, but non-empty active values must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_active_unique_idx" ON "User" (LOWER("email")) WHERE "email" IS NOT NULL AND "isDeleted" = false;
CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_active_unique_idx" ON "User" ("phone") WHERE "phone" IS NOT NULL AND "isDeleted" = false;
