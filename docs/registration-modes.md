# 注册模式配置

注册开关由两层共同决定：

1. `ALLOW_REGISTER=false`：服务器环境变量强制关闭注册，后台无法覆盖。
2. 后台 `registrationMode`：日常运营注册模式，保存在 `SiteSetting` 的 `registration.mode`。

支持模式：

- `PHONE`：仅手机号注册，不发送短信验证码，`phoneVerifiedAt` 保持 `null`。
- `EMAIL`：仅邮箱注册，必须发送验证邮件，验证后写入 `emailVerifiedAt`。
- `BOTH`：手机号和邮箱均可注册，注册页显示两个 Tab。
- `CLOSED`：暂停新用户注册，旧用户仍可登录。

## 备案期间建议

环境变量：

```env
ALLOW_REGISTER=true
ENABLE_TURNSTILE=false
NEXT_PUBLIC_ENABLE_TURNSTILE=false
```

后台设置：

```text
注册模式 = PHONE
```

也可以临时用 SQL 设置：

```sql
insert into "SiteSetting" ("id", "key", "value", "valueType", "group", "label", "createdAt", "updatedAt")
values ('site-setting-registration-mode', 'registration.mode', 'PHONE', 'TEXT', 'system', '注册模式', now(), now())
on conflict ("key") do update set "value" = 'PHONE', "updatedAt" = now();
```

## 备案完成后建议

环境变量：

```env
ALLOW_REGISTER=true
ENABLE_TURNSTILE=true
NEXT_PUBLIC_ENABLE_TURNSTILE=true
APP_URL=https://ecfc.fans
NEXT_PUBLIC_APP_URL=https://ecfc.fans
RESEND_API_KEY=...
EMAIL_FROM="EasonFansClub <noreply@ecfc.fans>"
```

后台设置：

```text
注册模式 = EMAIL
```

修改 `NEXT_PUBLIC_*` 环境变量后必须重新 build；后台切换 `registrationMode` 不需要重新部署。

生产部署：

```bash
cd ~/EasonFansClub
git pull
pnpm install
pnpm prisma generate
pnpm prisma migrate deploy
pnpm build
pm2 restart easonfansclub --update-env
```
