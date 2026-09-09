# 邮箱验证与系统通知

## 环境变量

生产环境需要配置：

```env
APP_URL=https://ecfc.fans
NEXT_PUBLIC_APP_URL=https://ecfc.fans
TENCENT_EMAIL_REGION=ap-hongkong
TENCENT_EMAIL_FROM=0727@ecfc.fans
TENCENT_EMAIL_SECRET_ID=
TENCENT_EMAIL_SECRET_KEY=
TENCENT_EMAIL_VERIFICATION_LINK_TEMPLATE_ID=
TENCENT_EMAIL_REGISTER_TEMPLATE_ID=
TENCENT_EMAIL_PROFILE_TEMPLATE_ID=
TENCENT_EMAIL_RESET_TEMPLATE_ID=
TENCENT_EMAIL_RESET_LINK_TEMPLATE_ID=
```

验证码模板必须包含 `{{code}}`；验证链接模板必须包含应用传入的链接变量；密码重置链接模板必须包含 `{{reset_url}}`。不要把验证码模板 ID 配置到链接邮件变量上。

设置 `MAIL_SMOKE_TEST_RECIPIENT` 为受控测试邮箱后，可运行 `pnpm mail:smoke` 做真实 Tencent SES 发送验证；未设置时脚本不会发信。

不要把真实腾讯云密钥、JWT Secret、数据库密码提交到仓库。

## 邮箱登录规则

- 手机号登录不受邮箱验证状态影响。
- 邮箱登录必须满足 `emailVerifiedAt` 不为空。
- 邮箱注册后不自动登录，用户需要先完成邮箱验证。
- 修改邮箱会清空 `emailVerifiedAt`，撤销旧验证 token，并向新邮箱发送验证邮件。
- 重发验证邮件会让旧 token 失效。
- 数据库仅保存邮箱验证 token 的 SHA-256 hash。

## 系统通知有效规则

当前有效系统通知必须同时满足：

- `published = true`
- `publishAt <= now`
- `expireAt IS NULL OR expireAt > now`

统一排序：

1. `sticky DESC`
2. `priority DESC`
3. `publishAt DESC`
4. `createdAt DESC`

## 更新日志

更新日志使用 `SystemNotification`：

- `type = UPDATE`
- `version` 必填
- 不再为新更新日志写入独立 `Changelog` 表

旧 `Changelog` 表保留，避免破坏历史 migration 和已有数据。

## 生产部署

如果本轮包含数据库 migration，腾讯云执行：

```bash
cd ~/EasonFansClub
git pull
pnpm install
pnpm prisma generate
pnpm prisma migrate deploy
pnpm build
pm2 restart easonfansclub --update-env
```
