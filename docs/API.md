# 私家E院社区 API 文档

本项目使用 Next.js App Router API Routes，登录态通过 `eason_fans_session` JWT Cookie 保存。

## 认证

- `POST /api/auth/register`：注册账号，支持用户名、邮箱、手机号字段。
- `POST /api/auth/login`：登录。
- `POST /api/auth/logout`：退出登录。
- `POST /api/auth/demo`：免注册体验登录。
- `POST /api/auth/forgot-password`：创建重置密码记录，邮件/短信发送接口已预留。
- `POST /api/auth/reset-password`：使用重置令牌修改密码。
- `POST /api/auth/change-password`：登录用户修改密码。

## 用户

- `GET /api/users/me`：获取当前用户资料、等级、积分、勋章、关注数。
- `PATCH /api/users/me`：修改昵称、头像、背景图、简介。
- `POST /api/users/:userId/follow`：关注用户。
- `DELETE /api/users/:userId/follow`：取消关注。
- `POST /api/users/:userId/block`：拉黑用户。
- `DELETE /api/users/:userId/block`：取消拉黑。

## 论坛

- `GET /api/boards`：获取板块列表。
- `GET /api/posts`：获取帖子列表，支持 `board`、`take` 参数。
- `POST /api/posts`：发布帖子。
- `GET /api/posts/:postId`：获取帖子详情。
- `PATCH /api/posts/:postId`：管理员更新置顶、精华、删除等状态。
- `POST /api/posts/:postId/replies`：回复帖子，支持二级回复数据结构。
- `POST /api/posts/:postId/like`：点赞帖子。
- `DELETE /api/posts/:postId/like`：取消点赞帖子。
- `POST /api/posts/:postId/favorite`：收藏帖子。
- `DELETE /api/posts/:postId/favorite`：取消收藏帖子。
- `POST /api/replies/:replyId/like`：点赞回复。
- `DELETE /api/replies/:replyId/like`：取消点赞回复。

## 签到

- `GET /api/checkin`：获取今日签到状态、连续签到、总积分、排行榜。
- `POST /api/checkin`：每日签到，每天只能一次，随机增加 3-7 积分。

## 通知

- `GET /api/notifications`：获取通知列表，可传 `unread=1`。
- `PATCH /api/notifications`：把指定通知或全部通知标记为已读。

## 搜索

- `GET /api/search?q=关键词`：搜索用户、帖子、板块、标签。
- `GET /api/search`：获取热门搜索词。

## 管理员

- `GET /api/admin/dashboard`：注册、在线、发帖、回复、签到、热门帖子和活跃用户统计。
- `GET /api/admin/users`：用户列表。
- `PATCH /api/admin/users/:userId`：封禁、解封、删除、修改等级和积分。
- `GET /api/admin/boards`：板块管理列表。
- `POST /api/admin/boards`：创建板块。

## 已预留的数据模块

Prisma 模型已覆盖：邮箱验证、手机验证码、登录设备、在线状态、板块分类、子板块、帖子标签、图片/视频附件、投票、举报、私信、活动、抽奖、勋章、网站设置、轮播图、敏感词、限流日志。
