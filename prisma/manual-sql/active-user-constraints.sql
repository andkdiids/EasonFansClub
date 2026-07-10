-- Supabase/PostgreSQL constraints that Prisma cannot express as partial unique indexes.
-- Run after the Prisma schema has been pushed and the related tables exist.

CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_active_unique"
ON "User" ("phone")
WHERE "phone" IS NOT NULL
  AND "status" = 'ACTIVE'
  AND "isDeleted" = false;

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_active_unique"
ON "User" ("email")
WHERE "email" IS NOT NULL
  AND "status" = 'ACTIVE'
  AND "isDeleted" = false;

CREATE UNIQUE INDEX IF NOT EXISTS "FriendRequest_pending_unique"
ON "FriendRequest" ("senderId", "receiverId")
WHERE "status" = 'PENDING';

CREATE INDEX IF NOT EXISTS "User_active_lookup_idx"
ON "User" ("status", "isDeleted", "uid");

CREATE INDEX IF NOT EXISTS "Profile_user_lookup_idx"
ON "Profile" ("userId");
