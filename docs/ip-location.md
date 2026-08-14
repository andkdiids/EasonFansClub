# IP 属地链路

## 当前生产链路

仓库中的正式部署流程确认的是：

```text
用户 → Nginx → Next.js / PM2
```

当前仓库没有证据证明正式入口前一定还有 Cloudflare/CDN；如果 DNS 或腾讯云控制台另有 CDN，必须先确认其可信出口地址，并按下面的代理规则配置。

应用默认只信任 Nginx 重写的 `X-ECFC-Client-IP`，不解析浏览器可以伪造的 `X-Forwarded-For`。Nginx 需要在每个反代 location 设置：

```nginx
proxy_set_header X-ECFC-Client-IP $remote_addr;
proxy_set_header X-ECFC-Remote-Address $remote_addr;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header CF-Connecting-IP "";
```

如果前面确实是 Cloudflare，不能直接把 `$remote_addr` 当用户地址；应先只对 Cloudflare 官方 IP 段配置 `set_real_ip_from`，再使用 `real_ip_header CF-Connecting-IP` 和 `real_ip_recursive on`，最后仍由 Nginx 重写 `X-ECFC-Client-IP`。应用侧只有显式设置 `TRUSTED_CLIENT_IP_SOURCE=cloudflare` 时才会读取 `CF-Connecting-IP`。

## 应用侧约定

- `getClientIp(request)` 是唯一入口；默认可信优先级只有 `X-ECFC-Client-IP`。
- `TRUSTED_CLIENT_IP_SOURCE=cloudflare` 时优先使用 Nginx 重写的 `X-ECFC-Client-IP`，其次才是可信链路的 `CF-Connecting-IP`。
- `TRUSTED_CLIENT_IP_SOURCE=nginx-legacy` 仅用于已确认安全的旧 Nginx 配置，会额外读取 `X-Real-IP`。
- `TRUSTED_CLIENT_IP_SOURCE=nginx-forwarded` 仅用于已确认会清洗并重写转发链的 Nginx；此模式按 `X-Forwarded-For` 左到右取第一个公开 IP，再回退到 `X-Real-IP`。
- 默认模式下 `X-Forwarded-For` 只进入诊断日志，不参与解析；普通客户端不能靠它伪造属地。
- `IP_DIAGNOSTICS_LOG=true` 时仅记录 `cfConnectingIp`、`xRealIp`、`xForwardedFor`、`remoteAddress`、`resolvedClientIp`，不记录 Cookie、Token 或请求体。

IP 位置按规范化后的单个 IP 缓存，解析失败、超时、限流或无可信 IP 都返回未知，不会回退到广东。

## 解析和历史数据

默认服务为 `https://ipapi.co/{ip}/json/`，可通过 `IP_LOCATION_API_URL` 和 `IP_LOCATION_API_KEY` 替换。IPv4、IPv6、国家、省份和可选 ISP 字段都在解析层处理；ISP 不改变当前前台只显示省/地区的文案。

数据库目前只保存 `ipRegion`，没有可供重算的内容级原始 IP。因此历史上仅保存“广东”的记录不能猜测恢复，也不做批量改写；用户下一次产生需要记录 IP 的行为时，成功解析的新值才会更新。
