-- AddColumn
ALTER TABLE `DirectMessage`
  ADD COLUMN `clientMessageId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `DirectMessage_senderId_clientMessageId_key`
  ON `DirectMessage`(`senderId`, `clientMessageId`);
