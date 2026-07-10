# Prisma 数据库模型字段说明

本文说明 `schema.prisma` 中每张表和每个字段的作用。

## 枚举

### UserRole

- `USER`：普通用户。
- `ADMIN`：管理员，可删除帖子、置顶帖子、设置精华帖等。

### PointActionType

- `POST_CREATE`：发帖获得积分。
- `REPLY_CREATE`：回复获得积分。
- `DAILY_CHECK_IN`：每日签到获得积分。
- `POST_LIKE_RECEIVED`：帖子被点赞后，帖子作者获得积分。
- `ADMIN_ADJUST`：管理员手动调整积分。

### AdminActionType

- `DELETE_POST`：删除帖子。
- `RESTORE_POST`：恢复帖子。
- `PIN_POST`：置顶帖子。
- `UNPIN_POST`：取消置顶。
- `FEATURE_POST`：设置精华帖。
- `UNFEATURE_POST`：取消精华。
- `DELETE_REPLY`：删除回复。
- `RESTORE_REPLY`：恢复回复。
- `ADJUST_POINTS`：调整用户积分。
- `UPDATE_BOARD`：更新板块。
- `UPDATE_USER_ROLE`：修改用户角色。

## User 用户表

- `id`：用户唯一 ID。
- `username`：登录用户名，唯一。
- `email`：邮箱，可为空，唯一。
- `phone`：手机号，可为空，唯一。
- `passwordHash`：加密后的密码，不保存明文密码。
- `nickname`：用户昵称，用于页面展示。
- `avatarUrl`：头像地址。
- `bio`：个人简介。
- `role`：用户角色，普通用户或管理员。
- `level`：用户等级，可由积分换算得到。
- `points`：当前总积分。
- `consecutiveDays`：连续签到天数。
- `lastCheckInDate`：最近一次签到日期。
- `createdAt`：注册时间。
- `updatedAt`：资料更新时间。
- `posts`：该用户发布的帖子。
- `replies`：该用户发布的回复。
- `likes`：该用户点过的赞。
- `checkIns`：该用户的签到记录。
- `pointLogs`：该用户的积分流水。
- `adminActions`：该管理员执行过的管理操作。
- `targetAdminActions`：该用户作为被操作对象时对应的管理日志。

## Board 板块表

- `id`：板块唯一 ID。
- `name`：板块名称，例如公告区、每日水楼。
- `slug`：URL 友好的板块标识，例如 `announcements`。
- `description`：板块介绍。
- `sortOrder`：排序值，数字越小越靠前。
- `postCount`：板块帖子数量，用于列表快速展示。
- `isActive`：板块是否启用。
- `createdAt`：创建时间。
- `updatedAt`：更新时间。
- `posts`：该板块下的帖子。
- `adminActions`：与该板块相关的管理操作。

## Post 帖子表

- `id`：帖子唯一 ID。
- `title`：帖子标题。
- `content`：帖子正文。
- `viewCount`：浏览次数。
- `likeCount`：点赞数量。
- `replyCount`：回复数量。
- `isPinned`：是否置顶。
- `isFeatured`：是否精华帖。
- `isDeleted`：是否软删除。
- `deletedAt`：删除时间。
- `createdAt`：发布时间。
- `updatedAt`：更新时间。
- `authorId`：发帖用户 ID。
- `author`：发帖用户。
- `boardId`：所属板块 ID。
- `board`：所属板块。
- `replies`：帖子下的回复。
- `likes`：帖子收到的点赞。
- `adminActions`：与该帖子相关的管理操作。

## Reply 回复表

- `id`：回复唯一 ID。
- `content`：回复内容。
- `isDeleted`：是否软删除。
- `deletedAt`：删除时间。
- `createdAt`：回复时间。
- `updatedAt`：更新时间。
- `postId`：所属帖子 ID。
- `post`：所属帖子。
- `authorId`：回复用户 ID。
- `author`：回复用户。
- `parentId`：父回复 ID，用于楼中楼。
- `parent`：父回复。
- `children`：子回复列表。
- `adminActions`：与该回复相关的管理操作。

## Like 点赞表

- `id`：点赞记录唯一 ID。
- `createdAt`：点赞时间。
- `postId`：被点赞帖子 ID。
- `post`：被点赞帖子。
- `userId`：点赞用户 ID。
- `user`：点赞用户。

约束：

- `@@unique([postId, userId])`：同一个用户对同一篇帖子只能点赞一次。

## CheckIn 签到表

- `id`：签到记录唯一 ID。
- `checkDate`：签到日期，建议业务层保存为当天零点日期。
- `points`：本次签到获得的积分，默认 10。
- `streakDay`：本次签到后的连续签到天数。
- `createdAt`：签到创建时间。
- `userId`：签到用户 ID。
- `user`：签到用户。

约束：

- `@@unique([userId, checkDate])`：同一用户同一天只能签到一次。

## PointLog 积分流水表

- `id`：积分流水唯一 ID。
- `action`：积分变动类型。
- `points`：本次变动积分，可正可负。
- `before`：变动前积分。
- `after`：变动后积分。
- `reason`：积分变动原因。
- `createdAt`：记录时间。
- `userId`：积分变动所属用户 ID。
- `user`：积分变动所属用户。
- `postId`：关联帖子 ID，可为空。
- `replyId`：关联回复 ID，可为空。
- `checkInId`：关联签到 ID，可为空。

用途：

- 发帖 +5。
- 回复 +2。
- 签到 +10。
- 帖子被点赞，帖子作者 +1。
- 管理员手动调整积分。

## AdminAction 管理员操作日志表

- `id`：操作日志唯一 ID。
- `action`：管理员操作类型。
- `reason`：操作原因。
- `metadata`：额外信息，例如调整前后状态、备注、客户端信息等。
- `createdAt`：操作时间。
- `adminId`：执行操作的管理员 ID。
- `admin`：执行操作的管理员。
- `targetUserId`：被操作用户 ID，可为空。
- `targetUser`：被操作用户。
- `postId`：被操作帖子 ID，可为空。
- `post`：被操作帖子。
- `replyId`：被操作回复 ID，可为空。
- `reply`：被操作回复。
- `boardId`：被操作板块 ID，可为空。
- `board`：被操作板块。

用途：

- 保留后台操作审计记录。
- 支持追踪谁删除了帖子、谁设置了精华、谁调整了积分。
