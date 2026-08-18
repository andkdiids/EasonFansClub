-- 生日祝福卡片与好友生日提醒
-- 1) 扩展 Notification 类型枚举，新增好友生日提醒
ALTER TABLE `Notification` MODIFY COLUMN `type` ENUM('REPLY','LIKE','SYSTEM','MESSAGE','ACTIVITY','ADMIN','FOLLOW','BADGE','FRIEND_REQUEST','BIRTHDAY_GREETING','GUESS_SONG_DUEL_INVITE','USER_REWARD','FRIEND_BIRTHDAY') NOT NULL;

-- 2) 新增生日公开开关（默认公开：卡片上展示生日日期）；仅控制展示，不影响通知生成与卡片打开
ALTER TABLE `User` ADD COLUMN `birthdayPublic` TINYINT(1) NOT NULL DEFAULT 1;

-- 3) 修复历史错误的生日通知跳转地址（原本指向不存在的 /profile/edit，点击即 404）
UPDATE `Notification` SET `link` = '/birthday-card' WHERE `type` = 'BIRTHDAY_GREETING' AND `link` = '/profile/edit';
