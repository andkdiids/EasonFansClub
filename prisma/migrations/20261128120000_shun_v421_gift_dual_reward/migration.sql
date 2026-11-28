-- V4.2.1 天使的礼物双向赠礼：
-- 1) 赠送者的随机回礼必须在结算前持久化（senderCode），重试不重抽。
-- 2) 赠送者回礼需要可区分的持久化获取来源（GIFT_REWARD），不得伪装成主线/社区掉落。
-- 3) 赠礼记录需能从 ShunItemGift 关联出双方实际道具，历史记录按用户分页查询。
-- 历史行不重写、不补发：senderCode / rewardEntryId 对旧数据为 NULL。

-- AlterTable: 结算前持久化赠送者回礼结果
ALTER TABLE `ShunItemGiftIntent`
    ADD COLUMN `senderCode` ENUM('EXTRA_ATTEMPT', 'FRIEND_GIFT', 'EXTRA_SUSPECT', 'REVENGE', 'TARGET_FRIEND', 'DOUBLE_AMOUNT', 'RETRY_CAPTURE') NULL;

-- AlterTable: 区分赠送者回礼这一独立获取来源
ALTER TABLE `ShunItemEntry`
    MODIFY `type` ENUM('DAILY_MAIN', 'COMMUNITY_DROP', 'WEEKLY_REWARD', 'GIFT_RECEIVED', 'USED', 'GIFT_SENT', 'GIFT_REWARD', 'RESERVED', 'RELEASED') NOT NULL;

-- AlterTable: 赠礼记录关联赠送者回礼流水
ALTER TABLE `ShunItemGift`
    ADD COLUMN `rewardEntryId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `ShunItemGift_rewardEntryId_key` ON `ShunItemGift`(`rewardEntryId`);

-- AddForeignKey
ALTER TABLE `ShunItemGift` ADD CONSTRAINT `ShunItemGift_rewardEntryId_fkey` FOREIGN KEY (`rewardEntryId`) REFERENCES `ShunItemEntry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: 历史记录按用户 + 分类倒序分页
CREATE INDEX `ShunItemEntry_userId_type_createdAt_idx` ON `ShunItemEntry`(`userId`, `type`, `createdAt`);
