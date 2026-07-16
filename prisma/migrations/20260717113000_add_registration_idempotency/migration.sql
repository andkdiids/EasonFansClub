ALTER TABLE "User"
ADD COLUMN "registrationIdempotencyKeyHash" TEXT;

CREATE UNIQUE INDEX "User_registrationIdempotencyKeyHash_key"
ON "User"("registrationIdempotencyKeyHash");
