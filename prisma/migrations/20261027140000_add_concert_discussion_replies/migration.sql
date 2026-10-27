ALTER TABLE `ConcertDiscussionComment`
  ADD COLUMN `parentCommentId` VARCHAR(191) NULL,
  ADD INDEX `ConcertDiscussionComment_parent_feed_idx` (`parentCommentId`, `moderationStatus`, `isDeleted`, `createdAt`),
  ADD CONSTRAINT `ConcertDiscussionComment_parentCommentId_fkey`
    FOREIGN KEY (`parentCommentId`) REFERENCES `ConcertDiscussionComment` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
