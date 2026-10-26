CREATE TABLE `ConcertEvent` (
  `id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `subtitle` VARCHAR(300) NULL,
  `slug` VARCHAR(191) NOT NULL,
  `venue` VARCHAR(300) NULL,
  `startDate` DATE NULL,
  `endDate` DATE NULL,
  `description` TEXT NOT NULL,
  `sourceNote` TEXT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Hong_Kong',
  `registrationUrl` TEXT NULL,
  `registrationEnabled` BOOLEAN NOT NULL DEFAULT false,
  `registrationLabel` VARCHAR(80) NOT NULL DEFAULT '登记入口',
  `homepageFeatured` BOOLEAN NOT NULL DEFAULT false,
  `activityCenterVisible` BOOLEAN NOT NULL DEFAULT true,
  `allowMarking` BOOLEAN NOT NULL DEFAULT true,
  `allowDiscussion` BOOLEAN NOT NULL DEFAULT true,
  `status` ENUM('DRAFT', 'UPCOMING', 'REGISTRATION', 'WAITING_DRAW', 'SHOWING', 'ENDED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ConcertEvent_slug_key` (`slug`),
  INDEX `ConcertEvent_status_homepageFeatured_idx` (`status`, `homepageFeatured`),
  INDEX `ConcertEvent_status_activityCenterVisible_idx` (`status`, `activityCenterVisible`),
  INDEX `ConcertEvent_startDate_endDate_idx` (`startDate`, `endDate`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

CREATE TABLE `ConcertShow` (
  `id` VARCHAR(191) NOT NULL,
  `eventId` VARCHAR(191) NOT NULL,
  `date` DATE NOT NULL,
  `startTime` VARCHAR(10) NULL,
  `title` VARCHAR(191) NULL,
  `albumTitle` VARCHAR(300) NOT NULL,
  `albumSubtitle` VARCHAR(300) NULL,
  `albumYear` INTEGER NULL,
  `songs` JSON NOT NULL,
  `note` TEXT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `status` ENUM('SCHEDULED', 'CANCELLED', 'ARCHIVED') NOT NULL DEFAULT 'SCHEDULED',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ConcertShow_eventId_date_sortOrder_idx` (`eventId`, `date`, `sortOrder`),
  INDEX `ConcertShow_eventId_status_date_idx` (`eventId`, `status`, `date`),
  CONSTRAINT `ConcertShow_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `ConcertEvent` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

CREATE TABLE `ConcertTimelineEvent` (
  `id` VARCHAR(191) NOT NULL,
  `eventId` VARCHAR(191) NOT NULL,
  `type` ENUM('REGISTRATION_OPEN', 'REGISTRATION_CLOSE', 'FIRST_DRAW_RESULT', 'FIRST_PAYMENT_DEADLINE', 'SECOND_DRAW_RESULT', 'SECOND_PAYMENT_DEADLINE', 'FIRST_SHOW', 'FINAL_SHOW', 'CUSTOM') NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `date` DATE NOT NULL,
  `startsAt` DATETIME(3) NULL,
  `endsAt` DATETIME(3) NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `countdownEnabled` BOOLEAN NOT NULL DEFAULT false,
  `notificationEnabled` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ConcertTimelineEvent_eventId_enabled_sortOrder_date_idx` (`eventId`, `enabled`, `sortOrder`, `date`),
  INDEX `ConcertTimelineEvent_eventId_type_idx` (`eventId`, `type`),
  CONSTRAINT `ConcertTimelineEvent_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `ConcertEvent` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

CREATE TABLE `ConcertShowMark` (
  `id` VARCHAR(191) NOT NULL,
  `eventId` VARCHAR(191) NOT NULL,
  `showId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `wantToGo` BOOLEAN NOT NULL DEFAULT false,
  `hasTicket` BOOLEAN NOT NULL DEFAULT false,
  `isPublic` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ConcertShowMark_userId_showId_key` (`userId`, `showId`),
  INDEX `ConcertShowMark_eventId_showId_wantToGo_isPublic_idx` (`eventId`, `showId`, `wantToGo`, `isPublic`),
  INDEX `ConcertShowMark_eventId_showId_hasTicket_isPublic_idx` (`eventId`, `showId`, `hasTicket`, `isPublic`),
  INDEX `ConcertShowMark_userId_wantToGo_hasTicket_idx` (`userId`, `wantToGo`, `hasTicket`),
  CONSTRAINT `ConcertShowMark_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `ConcertEvent` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ConcertShowMark_showId_fkey` FOREIGN KEY (`showId`) REFERENCES `ConcertShow` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ConcertShowMark_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

CREATE TABLE `ConcertTutorial` (
  `id` VARCHAR(191) NOT NULL,
  `eventId` VARCHAR(191) NOT NULL,
  `type` ENUM('REGISTRATION', 'TICKETING') NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `summary` TEXT NULL,
  `steps` JSON NOT NULL,
  `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ConcertTutorial_eventId_status_sortOrder_idx` (`eventId`, `status`, `sortOrder`),
  INDEX `ConcertTutorial_eventId_type_status_idx` (`eventId`, `type`, `status`),
  CONSTRAINT `ConcertTutorial_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `ConcertEvent` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

CREATE TABLE `ConcertReminderSubscription` (
  `id` VARCHAR(191) NOT NULL,
  `eventId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `targetType` ENUM('TIMELINE', 'SHOW') NOT NULL,
  `targetId` VARCHAR(191) NOT NULL,
  `showId` VARCHAR(191) NULL,
  `timelineEventId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ConcertReminderSubscription_dedup_key` (`userId`, `eventId`, `targetType`, `targetId`),
  INDEX `ConcertReminderSubscription_eventId_targetType_targetId_idx` (`eventId`, `targetType`, `targetId`),
  INDEX `ConcertReminderSubscription_userId_eventId_idx` (`userId`, `eventId`),
  INDEX `ConcertReminderSubscription_showId_idx` (`showId`),
  INDEX `ConcertReminderSubscription_timelineEventId_idx` (`timelineEventId`),
  CONSTRAINT `ConcertReminderSubscription_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `ConcertEvent` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ConcertReminderSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ConcertReminderSubscription_showId_fkey` FOREIGN KEY (`showId`) REFERENCES `ConcertShow` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ConcertReminderSubscription_timelineEventId_fkey` FOREIGN KEY (`timelineEventId`) REFERENCES `ConcertTimelineEvent` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

ALTER TABLE `Post`
  ADD COLUMN `concertShowId` VARCHAR(191) NULL,
  ADD INDEX `Post_concertShowId_status_isDeleted_createdAt_idx` (`concertShowId`, `status`, `isDeleted`, `createdAt`),
  ADD CONSTRAINT `Post_concertShowId_fkey` FOREIGN KEY (`concertShowId`) REFERENCES `ConcertShow` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the first admin-managed event from the reviewed local reference data.
INSERT INTO `ConcertEvent` (`id`, `title`, `subtitle`, `slug`, `venue`, `startDate`, `endDate`, `description`, `sourceNote`, `timezone`, `registrationUrl`, `registrationEnabled`, `registrationLabel`, `homepageFeatured`, `activityCenterVisible`, `allowMarking`, `allowDiscussion`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-event-v1', 'Recording Sessions', 'Recording Sessions with Mr. Eason Chan', 'recording-sessions', '香港演艺学院 Lyric 剧院', '2026-12-12', '2027-02-20', '以專輯與歌單為線索，記錄 26 場 Recording Sessions。演出資料及曲目整理自用户提供的本地参考页面，尚未独立核实；场次、曲目与票务安排请以主办方最新公告为准。', '内容来源：用户提供的 cityline-tutorial.html（本地参考文件，未独立核验）。私家E院是粉丝社区专题，不代表 Cityline、主办方或场地方。', 'Asia/Hong_Kong', 'https://cultural.cityline.com/sc/2026/baleasonregchan.html', true, '登记入口', true, true, true, true, 'UPCOMING', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20261212', 'recording-sessions-event-v1', '2026-12-12', '20:00', NULL, '《陳奕迅》', NULL, 1996, JSON_ARRAY('时代曲', '伤信', '游离份子', '我怕你不肯', '有意无意', '安守本分', '爱情·幼稚', '从未痴心', '其实我记得（与杨千嬅合唱）', '当心中有恋爱感觉'), NULL, 1, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20261213', 'recording-sessions-event-v1', '2026-12-13', '20:00', NULL, '《與我常在》', NULL, 1998, JSON_ARRAY('现场直播', '与我常在', '没有左右', '生命有几好', '拥抱这分钟', '那一夜没有雪？', '伴游', '跟我走好吗', '今天等我来', '故人', '那一夜有没有说'), NULL, 2, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20261216', 'recording-sessions-event-v1', '2026-12-16', '20:00', NULL, '《I Had A Great Time!》', NULL, 2004, JSON_ARRAY('24', '万佛朝宗', '一切还好', '冤气', '八里公路', '放下来', '爱你入骨', '最后今晚', '不求人', '开不了心'), NULL, 3, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20261217', 'recording-sessions-event-v1', '2026-12-17', '20:00', NULL, '《The Easy Ride》', NULL, 2001, JSON_ARRAY('阿士匹灵', '阳性反应', '冲口而出', '大开眼戒', '我不好爱', '热带雨林', '人工智能', '结束开始', '活着多好', '他一个人', '不知所谓'), NULL, 4, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20261219', 'recording-sessions-event-v1', '2026-12-19', '20:00', NULL, '《H³M》', NULL, 2009, JSON_ARRAY('Allegro Opus 3.3am', '还有什么可以送给你', '于心有愧', '今天只做一件事', '一个旅人', '七百年后', 'Life Goes On', '太阳照常升起', '不来也不去', '沙龙'), NULL, 5, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20261220', 'recording-sessions-event-v1', '2026-12-20', '20:00', NULL, '《Taste the Atmosphere》；《Stranger Under My Skin》', NULL, NULL, JSON_ARRAY('Welcome to the Future', '讲男讲女', '叶问风中转', '花花世界', '我杯茶（与莫文蔚合唱）', '蜃楼', 'My Private Christmas Song', '苦瓜', '六月飞霜', 'Stranger Under My Skin', '沼气', '最后派对', '等你爱我', '因为爱情', '乐园'), NULL, 6, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20261223', 'recording-sessions-event-v1', '2026-12-23', '20:00', NULL, '《不想放手》', NULL, 2008, JSON_ARRAY('路…一直都在', '不要说话', '七', '绑带人生', 'Aren''t You Glad?', '土星环', '漂亮小姐', '独居动物', '臭美', '然后怎样'), NULL, 7, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20261224', 'recording-sessions-event-v1', '2026-12-24', '20:00', NULL, '《4 A Change & Hits》；《幸福》；《新生活》', NULL, NULL, JSON_ARRAY('King Kong', 'Lonely Christmas', '第一类接触', '少见不怪', '幸福摩天轮', '垃圾', '时光倒流二十年', '非走不可', '忽然难过', '有了你', '春光乍泄', '改造人', '飘飘飘', '专家话', '超人的主题曲+屎捞人', '终于一百日', '新生活', '游移的伤口', '地狱咒', '天一半，地一半', '回绝', '美满人生'), '圣诞前夜', 8, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20261226', 'recording-sessions-event-v1', '2026-12-26', '20:00', NULL, '《黑·白·灰》', NULL, 2003, JSON_ARRAY('阿怪', '我们都寂寞', '兄妹', '十年', '要你的', '世界', '谢谢', '像一句广告', '寂寞奏鸣曲', 'Last Order'), '圣诞节后', 9, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20261227', 'recording-sessions-event-v1', '2026-12-27', '20:00', NULL, '《Special Thanks To…》', NULL, 2002, JSON_ARRAY('Special Thanks To 1', 'Special Thanks To 2', 'Special Thanks To 3', '人造卫星', '你会不会', '你的背包', '想哭', '没有手机的日记', '狂人日记', '男人的错', '谢谢侬', '跳蚤市场', '故事'), NULL, 10, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270106', 'recording-sessions-event-v1', '2027-01-06', '20:00', NULL, '《What''s Going On...?》', NULL, 2006, JSON_ARRAY('裙下之臣', '最后的嬉皮士', '白玫瑰', '黑择明', '富士山下', '不如不见', '心深伤透', '解药', '天公地道', '粤语残片'), NULL, 11, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270107', 'recording-sessions-event-v1', '2027-01-07', '20:00', NULL, '《認了吧》', NULL, 2007, JSON_ARRAY('烟味', '淘汰', '快乐男生', '红玫瑰', '月黑风高', '爱情转移', '好久不见', '爱是一本书', '第一个雅皮士', '白色球鞋'), NULL, 12, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270109', 'recording-sessions-event-v1', '2027-01-09', '20:00', NULL, '《Life Continues...》；《Time Flies》', NULL, NULL, JSON_ARRAY('低调', '车志', '最佳损友', '暴殄天物', '落花流水', '大得太快', '想听', '无人之境', '大人', '一丝不挂', '陀飞轮', '心腹', '味之素'), NULL, 13, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270110', 'recording-sessions-event-v1', '2027-01-10', '20:00', NULL, '《Solidays》', NULL, 2008, JSON_ARRAY('新曲：歌·颂', '后台（另精选收录：K歌之王 / 十年 / 单车 / 富士山下 / 浮夸等粤语国语代表作）'), NULL, 14, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270123', 'recording-sessions-event-v1', '2027-01-23', '20:00', NULL, '《天佑爱人》', NULL, 1999, JSON_ARRAY('昨日', '今日', '每一个明天', '眼眉调', '一', '第五个现代化', '快高长大', '如果这一秒钟你跟我讲你不爱我', '我的世界末日', '贝多芬与我'), NULL, 15, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270124', 'recording-sessions-event-v1', '2027-01-24', '20:00', NULL, '《Listen To Eason Chan》', NULL, 2007, JSON_ARRAY('玛利奥派对', '热岛小夜曲', '闪', '演唱会', '滑铁卢车站', 'Crying in the Party', '狂热', '变色龙', '时代巨轮', '乜嘢啫', '兄弟（国）（与刘德华合唱）'), NULL, 16, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270127', 'recording-sessions-event-v1', '2027-01-27', '20:00', NULL, '《Nothing Really Matters》', NULL, 2000, JSON_ARRAY('Made In Hong Kong', '黑夜不再来', '美丽有罪', '戏迷情人', '和平饭店', '我感激', '到此一游', '当这地球没有花', '爱上你是我眼睛的错'), NULL, 17, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270128', 'recording-sessions-event-v1', '2027-01-28', '20:00', NULL, '《怎麼樣》', NULL, 2005, JSON_ARRAY('不能再等待', '对不起谢谢', 'Hippie', '不然你要我怎么样', '不睡', '一夜销魂', '浮城', '早开的长途班', '听听（粤）', '人神斗（粤）'), NULL, 18, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270130', 'recording-sessions-event-v1', '2027-01-30', '20:00', NULL, '《The Line-Up》', NULL, 2002, JSON_ARRAY('心里有鬼', '我有我爱你', '明年今日', '人来人往', '季军', '随意门', '1874', '防不胜防', '两名男子街头相遇', '黑面'), NULL, 19, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270131', 'recording-sessions-event-v1', '2027-01-31', '20:00', NULL, '《Live For Today》', NULL, 2003, JSON_ARRAY('幸灾乐祸', 'Katrina', '十面埋伏', '吔边个边个', '小孩不懂怕', '真相', '谎言', '猜情寻', '忘记歌词', 'New Order', '岁月如歌'), NULL, 20, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270212', 'recording-sessions-event-v1', '2027-02-12', '20:00', NULL, '《打得火熱》', NULL, 2000, JSON_ARRAY('K歌之王', '打得火热', '新广告歌', '低等动物', '绵绵', '美丽谎言', '吹微风', '温室效应', '活跃症', '下周同样时间'), '春节假期内（以官方安排为准）', 21, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270213', 'recording-sessions-event-v1', '2027-02-13', '20:00', NULL, '《It''s Me 反正是我》', NULL, 2001, JSON_ARRAY('Good Times', 'K歌之王（国）', '爱是怀疑', '不如这样', '低等动物', '没有你', '全世界失眠', '我也不会那么做', '冤家'), '春节假期内（以官方安排为准）', 22, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270216', 'recording-sessions-event-v1', '2027-02-16', '20:00', NULL, '《上五楼的快活》', NULL, 2009, JSON_ARRAY('在你身边', '这样的一个麻烦', '多少', 'Nothing Ever Happened', '你为什么哭了呢', '谋情害命', '我甲你', '心的距离', '床头灯', '给你', '从何说起'), NULL, 23, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270217', 'recording-sessions-event-v1', '2027-02-17', '20:00', NULL, '《我的快樂時代》', NULL, 1998, JSON_ARRAY('我的快乐时代', '我什么都没有', '天下无双', '黄金时代', '新曲+精选', '愈想愈无谓', '相信相依', '两种讲法', '请相信我', '反高潮', '多一点'), NULL, 24, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270219', 'recording-sessions-event-v1', '2027-02-19', '20:00', NULL, '《Shall We Dance? Shall We Talk!》', NULL, 2001, JSON_ARRAY('Eason''s Angel', 'Shall We Talk', 'Shall We Dance', '单车', '孤独探戈', '怪物', '黑暗中漫舞', '伤心花舍', '失恋太少', '太空漫游', '天使的礼物'), NULL, 25, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertShow` (`id`, `eventId`, `date`, `startTime`, `title`, `albumTitle`, `albumSubtitle`, `albumYear`, `songs`, `note`, `sortOrder`, `status`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-show-20270220', 'recording-sessions-event-v1', '2027-02-20', '20:00', NULL, '《U87》', NULL, 2005, JSON_ARRAY('葡萄成熟时', '遇见了你（国）', '浮夸', '夕阳无限好', '16月6日晴', '怕死', '三个人的探戈', '烂', '不良嗜好', '新美人主义（国）', '阿牛', '大个女'), '元宵节', 26, 'SCHEDULED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertTimelineEvent` (`id`, `eventId`, `type`, `title`, `description`, `date`, `startsAt`, `endsAt`, `sortOrder`, `enabled`, `countdownEnabled`, `notificationEnabled`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-registration-open', 'recording-sessions-event-v1', 'REGISTRATION_OPEN', '登记抽签开放', NULL, '2026-10-28', '2026-10-28 03:00:00.000', NULL, 10, true, true, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertTimelineEvent` (`id`, `eventId`, `type`, `title`, `description`, `date`, `startsAt`, `endsAt`, `sortOrder`, `enabled`, `countdownEnabled`, `notificationEnabled`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-registration-close', 'recording-sessions-event-v1', 'REGISTRATION_CLOSE', '登记抽签截止', NULL, '2026-10-29', NULL, '2026-10-29 15:59:00.000', 20, true, true, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertTimelineEvent` (`id`, `eventId`, `type`, `title`, `description`, `date`, `startsAt`, `endsAt`, `sortOrder`, `enabled`, `countdownEnabled`, `notificationEnabled`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-first-draw', 'recording-sessions-event-v1', 'FIRST_DRAW_RESULT', '首轮抽签结果', NULL, '2026-11-02', NULL, NULL, 30, true, false, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertTimelineEvent` (`id`, `eventId`, `type`, `title`, `description`, `date`, `startsAt`, `endsAt`, `sortOrder`, `enabled`, `countdownEnabled`, `notificationEnabled`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-first-payment', 'recording-sessions-event-v1', 'FIRST_PAYMENT_DEADLINE', '首轮付款截止', NULL, '2026-11-05', NULL, NULL, 40, true, false, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertTimelineEvent` (`id`, `eventId`, `type`, `title`, `description`, `date`, `startsAt`, `endsAt`, `sortOrder`, `enabled`, `countdownEnabled`, `notificationEnabled`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-second-draw', 'recording-sessions-event-v1', 'SECOND_DRAW_RESULT', '次轮抽签结果', NULL, '2026-11-06', NULL, NULL, 50, true, false, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertTimelineEvent` (`id`, `eventId`, `type`, `title`, `description`, `date`, `startsAt`, `endsAt`, `sortOrder`, `enabled`, `countdownEnabled`, `notificationEnabled`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-second-payment', 'recording-sessions-event-v1', 'SECOND_PAYMENT_DEADLINE', '次轮付款截止', NULL, '2026-11-09', NULL, NULL, 60, true, false, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertTimelineEvent` (`id`, `eventId`, `type`, `title`, `description`, `date`, `startsAt`, `endsAt`, `sortOrder`, `enabled`, `countdownEnabled`, `notificationEnabled`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-first-show', 'recording-sessions-event-v1', 'FIRST_SHOW', 'Recording Sessions 首场', NULL, '2026-12-12', NULL, NULL, 70, true, false, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertTimelineEvent` (`id`, `eventId`, `type`, `title`, `description`, `date`, `startsAt`, `endsAt`, `sortOrder`, `enabled`, `countdownEnabled`, `notificationEnabled`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-final-show', 'recording-sessions-event-v1', 'FINAL_SHOW', 'Recording Sessions 最终场', NULL, '2027-02-20', NULL, NULL, 80, true, false, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertTutorial` (`id`, `eventId`, `type`, `title`, `summary`, `steps`, `status`, `sortOrder`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-registration-guide', 'recording-sessions-event-v1', 'REGISTRATION', '登记抽签步骤', '这是私家E院整理的用户参考资料。报名和账号操作均在外部登记服务完成；请以该服务的最新页面说明为准。', JSON_ARRAY(JSON_OBJECT('title', '先准备账号', 'body', '按参考资料提示，提前准备好外部登记服务账号。私家E院不会收集你的外部账号密码。'), JSON_OBJECT('title', '查看登记时间与官方须知', 'body', '页面显示的日期和规则来自用户提供的参考文件，尚未独立核实；提交前请在外部登记页面再次确认。'), JSON_OBJECT('title', '打开登记入口并填写资料', 'body', '通过本页后台配置的外部登记入口完成操作。请自行在外部服务输入资料，不要把证件、联系方式或支付资料发到社区。'), JSON_OBJECT('title', '保存确认编号并等待结果', 'body', '参考资料提示提交后应留存确认编号。抽签结果和后续安排请查看外部服务的最新通知；本专题不代为查询或处理票务账号。')), 'PUBLISHED', 10, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
INSERT INTO `ConcertTutorial` (`id`, `eventId`, `type`, `title`, `summary`, `steps`, `status`, `sortOrder`, `createdAt`, `updatedAt`) VALUES ('recording-sessions-ticketing-guide', 'recording-sessions-event-v1', 'TICKETING', '中签后付款与抢票教程', '当前参考文件没有提供可完整核实的付款与购票操作流程。内容待管理员补充并审核。', JSON_ARRAY(), 'DRAFT', 20, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
