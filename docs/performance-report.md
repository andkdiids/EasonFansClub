# 私家 E 院全站性能优化与加载检测报告

## 检测范围

- 检测日期：2026-08-10（Asia/Shanghai）
- 检测方式：本地 Next.js production build + Codex 浏览器，未部署生产环境
- 移动端视口：390 × 844；桌面端使用桌面浏览器默认视口
- 性能采集开关：页面 URL 添加 `?perf=1` 或 `?perf=true`
- 数据库结构、Prisma schema、migration、页面业务流程未修改

本次加入的采集器会记录 TTFB、FCP、LCP、DOMContentLoaded、load event、资源大小/耗时/渲染阻塞状态，以及 5 秒 `requestAnimationFrame` FPS 样本。结果同时写入 `window.__ECFC_PERF__` 和页面中的 `#ecfc-performance-audit` JSON 节点，便于浏览器和自动化测试读取。

## 已完成的优化

### 首页 Hero

- 新增页面可见性 hook，监听 `document.visibilityState` 和 `visibilitychange`。
- 视频 Hero 在页面 hidden、Hero 离开视口或用户偏好减少动画时调用 `video.pause()`；恢复 visible 且满足播放条件时调用 `video.play()`。
- 暂停/恢复不会调用 `load()`，也不会清空或重设 `src`，避免返回页面后重新下载视频。
- GIF/Animated WebP 保持原 `<img>` 节点和资源地址，hidden 时隐藏动画层，并在有独立封面时显示静态封面，不重复挂载资源。
- 增加 `IntersectionObserver`，Hero 不在视口时也停止动态播放。
- 首页 Hero 轮播计时器在页面 hidden 时暂停，返回 visible 后恢复。

### EasMusic

核心贴图改为 WebP 并保留原有视觉比例：

- 录音机主体：`public/easmusic/recorder-player-shell.webp`
- 磁带主体：`public/images/cassette/cassette-transparent.webp`
- EasMusic 首屏提前 preload 两张核心贴图，播放器结构无需等待全部素材后才显示。
- 两个静态资源使用一年期 `public, max-age=31536000, immutable` 缓存。

### Eason in Concert

- 首张卡片使用优先加载，其余卡片通过 `IntersectionObserver` 提前 240px 懒加载。
- 非首屏图片使用 `loading="lazy"`，展开详情使用优先加载。
- 轮盘布局尺寸通过 `ResizeObserver` 缓存，动画帧只更新 `transform`、`opacity`、层级和交互状态，避免每帧反复读取布局尺寸。
- 页面 hidden 时停止演唱会轮盘的 requestAnimationFrame 动画。

### 全站检测器

- 新增 `?perf=1` 检测模式，不影响普通用户访问。
- 资源按传输大小和耗时排序，最多记录 200 条，资源查询参数会被脱敏。
- FPS 统计平均 FPS、基于最长帧的最低 FPS、卡顿次数和最长帧时长；超过 34ms 计为一次卡顿。

## 页面加载速度排行

以下为实际采集到的公开页面结果；“首次加载”指 Navigation Timing 的 `loadEventEnd`，单位为毫秒。

| 排名 | 页面 | 设备 | 首次加载 | TTFB | FCP | LCP | 主要瓶颈 |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | `/login` | 桌面 | 47.1 | 13.6 | 80.0 | 80.0 | 未发现明显瓶颈 |
| 2 | `/register` | 移动端 | 48.7 | 14.7 | 96.0 | 96.0 | 未发现明显瓶颈 |
| 3 | `/register` | 桌面 | 75.8 | 22.6 | 144.0 | 144.0 | 未发现明显瓶颈 |
| 4 | `/login` | 移动端 | 132.4 | 14.3 | 96.0 | 124.0 | 本地浏览器启动/绘制波动，仍远低于目标 |

所有已测页面均满足 FCP < 1.8 秒、LCP < 2.5 秒。

### 路由覆盖说明

已请求首页、`/welcome`、E 院广场、帖子相关入口、活动、EasMusic 各入口、娱乐、游戏、表情包、通知、个人主页和后台入口。由于本地 `.env` 的 Prisma 连接地址不符合当前 Prisma Accelerate URL 格式，且没有使用用户账号会话，这些受保护页面均在页面渲染前跳转到 `/login`，因此没有把登录页数据冒充为业务页数据。性能采集器已经随全局 layout 接入；在有效登录会话下给这些 URL 添加 `?perf=1` 即可获得对应页面的真实指标。

## 资源加载排行与图片检查

| 资源 | 原始大小 | 当前运行时资源 | 变化 | 阻塞/优化建议 |
| --- | ---: | ---: | ---: | --- |
| 录音机主体 PNG → WebP | 1,236,330 B | 79,864 B | -93.5% | preload；不阻塞播放器框架 |
| 磁带主体 PNG → WebP | 1,325,096 B | 45,338 B | -96.6% | preload；不阻塞播放器框架 |
| 两张 EasMusic 核心贴图合计 | 2,561,426 B | 125,202 B | -95.1% | immutable 缓存 |
| 登录页首屏 CSS | 53,520 B 传输 / 295,407 B 解码 | — | — | CSS 为首屏必要样式；继续保持体积监控 |
| 登录页共享脚本 | 54,665 B 传输 / 173,024 B 解码 | — | — | 非阻塞；采集器会持续按资源排序 |

图片清单中发现一张现有用户上传文件超过 2MB：

`public/uploads/site/site-ea179d8f-b767-4856-8e26-61e1c76cd3eb.png`，6,229,223 B（约 5.94 MiB，2010 × 2048）。它没有在本次公开页面测试中加载，也没有安全地删除或替换，因为可能存在数据库/内容引用。现有站点图片上传接口已对后续站点图片执行尺寸限制和 WebP 转换；这张历史资源如需清理，应另行进行引用确认和数据迁移。

复测响应头：

- `/easmusic/recorder-player-shell.webp?v=20260810`：200，`public, max-age=31536000, immutable`
- `/images/cassette/cassette-transparent.webp?v=20260810`：200，`public, max-age=31536000, immutable`
- `/login?perf=1`：仍为 `no-store`，避免页面和 API 数据被公共缓存

## FPS 检测结果

采样时长为 5 秒；最低 FPS 按采样期间最长帧间隔计算。

| 页面 | 设备 | 平均 FPS | 最低 FPS | 卡顿次数 | 是否需要优化 |
| --- | --- | ---: | ---: | ---: | --- |
| `/login` | 桌面 | 60.0 | 60.0 | 0 | 否 |
| `/register` | 桌面 | 60.0 | 60.0 | 0 | 否 |
| `/login` | 移动端模拟视口 | 60.0 | 60.0 | 0 | 否 |
| `/register` | 移动端模拟视口 | 60.0 | 60.0 | 0 | 否 |

评价标准：55–60 FPS 为优秀，45–55 FPS 为可接受，低于 45 FPS 需要优化。公开未登录页未触发 Hero、EasMusic、听听游戏和演唱会轮盘，因此这些业务动画的真实设备结果需在有效会话下补测；相应的采集器和暂停逻辑已经就位。

## 发现的问题与处理结果

1. Hero 在页面 hidden 时仍可能继续播放：已通过可见性监听、视频 pause/play、动画图片隐藏和视口观察处理。
2. EasMusic 录音机和磁带贴图较大：运行时改用 WebP，合计传输体积降低约 95.1%，并增加 preload 和长期缓存。
3. 演唱会卡片可能一次加载过多海报：已改为首张优先、其余按视口懒加载。
4. middleware 对所有公开资源设置 no-store：已只为 EasMusic 核心静态目录放行 immutable 缓存，页面/API 缓存策略不变。
5. 存在一张超过 2MB 的历史用户上传 PNG：已记录但未删除，避免破坏内容引用。
6. 本地完整受保护路由检测受 Prisma 连接配置和账号会话限制；没有修改数据库或绕过鉴权逻辑。

## 优化前后对比

| 项目 | 优化前 | 优化后 |
| --- | --- | --- |
| 页面 hidden 时 Hero 视频 | 可能持续播放 | 自动 pause，visible 后恢复 |
| GIF/Animated WebP 返回页面 | 可能重新挂载/重新请求 | 保留原节点和 src，不主动重新下载 |
| EasMusic 录音机主体 | 1.18 MB PNG | 79.9 KB WebP + preload |
| EasMusic 磁带主体 | 1.26 MB PNG | 45.3 KB WebP + preload |
| 演唱会卡片 | 可能一次加载全部图片 | 首屏优先，其余 IntersectionObserver 懒加载 |
| 页面/接口缓存 | 现有 no-store 规则 | 仅不可变核心静态贴图使用长期缓存 |
| 性能检测 | 无统一页面内采集 | 可用 `?perf=1` 读取 TTFB/FCP/LCP/资源/FPS |

## 验证结果

- `pnpm.cmd exec tsc --noEmit`：通过
- 变更文件 ESLint：0 errors；仅有项目既有的 `<img>`、未使用函数等 warnings
- `pnpm.cmd build`：通过，Next.js production build 完成
- `git diff --check`：通过，无空白错误
- 未修改数据库结构、迁移文件或生产部署状态

