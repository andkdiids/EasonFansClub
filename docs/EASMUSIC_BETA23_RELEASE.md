# EasMUSIC beta.23 / code36

2026-11-17。沿用 docs/RELEASE_PROCESS.md，不新增发布工作流或人工备份/TLS门禁。本文不是生产或真机通过证明。

## 修复与实现

代码确认了三条原播放阻断路径：Android 将后台播放关闭且在 AppState 非 active 时主动暂停；原生音源解析拒绝 API 返回的合法相对试听地址，受保护音频路由缺少现有 Native Bearer 中间件白名单；浏览器在异步解析音源之后才恢复 AudioContext，并可能继续用已经连接 MediaElementSource 的 audio 播放无 CORS 音源。此版本分别修复这些路径，未绕过音源权限或 DRM。仍需发布后使用已授权账号验证真实曲目。

Android 由单一 Media3 / MediaSessionService 管理 ONLINE、LOCAL 队列，提供系统媒体控制、音频焦点、耳机拔出暂停、最近任务移除停止与通知清理。系统文件选择器获取持久只读 URI 授权，曲库、封面和音频留在设备。删除记录不删除原始文件。停止、切歌和账号切换保存已采样时长，后台记录不依赖 JS 持续运行。

POST /api/music/listening 只接收 eventId/source/seconds/startedAt/endedAt；认证决定用户，X-ECFC-Listening-Owner 仅用于拒绝账号切换竞态。最多30条/批、60秒/条，用户行锁和唯一键保证幂等，跨设备重叠事件单独拒绝并在客户端归档。累计时长继续使用 MusicPlayRecord；时长片段不虚增原有特定歌曲播放次数成就。

## 数据库兼容与恢复

增量迁移 20261117110000_add_music_listening_stats：MusicPlayRecord.trackId 允许 NULL，新增来源、事件ID和区间列及索引。旧记录默认 ONLINE，原业务数据不删除；经隔离 MySQL 验证旧写入、去重、并发及跨午夜汇总。正式 full 部署执行迁移，不能用 skip-db 绕过。

迁移后不回滚数据库。新事件写入后，旧应用的播放次数统计不具备新片段过滤语义；故障优先向前修复，应用恢复必须选择兼容新统计模型的 release。保留原有部署锁、SHA CAS、Worker维护及受保护应用恢复机制。

Android 当前回滚基线为 beta.22/code35：完整公开下载183859547字节、SHA256 86028B1E16F21C0B94F44B2AC20A9D8FBAD428B905113A3CBC3EB81971625133，正式证书一致。恢复 Version API 仅使用既有CAS工作流，不为验证而切回生产。

## 本地证据与未完成验收

- Mobile来源 ede686dcbff12887a745fc39c5fbac58a3d8611e，Git tree c4fccd533bbb472de580aeabb448744ffdc18f74。
- 正式脚本构建：E:\ECFC-Release-Artifacts\ECFC-1.0.0-beta.23-release-beta23-code36-final-20261117-141006.apk。
- 大小183952296；SHA256 F03DEAF2B2DCC7A8862D2613435344B237EA583CBA9532DAA7798BE704B38048。
- fans.ecfc.app / 1.0.0-beta.23 / code36 / min24 / target36 / 四ABI / 正式证书 / v2通过。v3未启用，不声称通过。
- TypeScript、ESLint、Prisma validate/generate、Next.js生产构建、原生模块编译与Manifest合并通过；原生统计8/8；Mobile全量789通过、27既有条件跳过、0失败；隐私规则追加回归2/2通过；Web真实隔离MySQL幂等、并发与跨午夜通过，临时容器清理。
- PR、完整CI、Web生产部署、COS/CDN及Version API结果待实际执行后补充。
- adb devices -l 无已授权设备；真实音频解码、后台/锁屏/熄屏、通知栏及蓝牙/来电/耳机、SAF授权、任务划除与覆盖升级未完成。实际Edge浏览器使用本机生成合法WAV验证真实MusicPlayerProvider：延迟元数据后AudioContext running、播放/暂停/继续/拖动/切歌、无CORS音源切换及错误状态通过；未代替生产认证曲目或Android真机验收。
