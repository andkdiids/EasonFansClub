# 实况照片统一媒体接口（供 Android / iOS 后续接入）

本期仅实现 Web/H5 与服务端，不修改或发布原生 App。以下接口复用项目现有登录鉴权（浏览器 Cookie 或 Bearer），返回值均为 JSON，错误包含 `code` 与 `message`。

## Web 端上传方式（本期变更）

Web/H5 不再提供「添加实况照片」独立入口，也不要求用户分别选择封面与视频。用户在原有图片按钮里一次选中照片即可：

1. 前端在**压缩之前**读取原始字节，识别 `GCamera:MicroVideoOffset` / `Container:Directory` 等原生动态照片元数据；
2. 命中时把原始文件整体作为 `cover` 提交（`manual=0`），服务端自行提取嵌入的 MP4；
3. 未命中且浏览器只给了静态照片时，按普通图片上传，不发 LIVE 标识。

移除的是 Web 的界面入口，服务端的配对上传能力（下表的 `video` 与 `manual`）继续保留，供 Android / iOS 通过原生相册接口取得配对资源后调用。

### 文件选择器

Web 的图片入口使用 `accept="image/*"`，不使用 MIME + 扩展名的长列表。Android 会把 `image/heic`、`.heif`、`.avif` 这类值解析成文档选择器（“档案”），只有 `image/*` 才稳定映射到系统相册。Motion Photo 本身就是一张 JPEG，选择器不需要接受视频类型。

### 媒体探测与转码工具

服务端不依赖 ffprobe（`@ffmpeg-installer/ffmpeg` 只提供 ffmpeg）：

1. 先用内置的 MP4 盒解析读取 `moov/mvhd`、`trak/tkhd`、`trak/mdia/hdlr` 与 `stsd`，得到时长、画面尺寸、音轨；
2. 盒解析读不出数字时，用 ffmpeg 实际解码一帧作为兜底（HEVC、异常的 `moov` 位置、带厂商尾部数据的文件都靠这一步通过），解码失败才拒绝；
3. 统一转码为 H.264/AAC MP4，长边不超过配置值，保留画面比例与声音，去除 GPS 等元数据。

后台 `/admin/live-photo` 会显示当前进程实际可用的 ffmpeg 版本，便于发布后核对。

### 上传诊断（管理员）

实况上传失败时，管理员的上传卡片会多出「复制诊断信息」，内容为浏览器 UA、入口、文件类型与大小、识别结果（容器、配对方式、尾部长度）、请求 ID、媒体任务状态与失败阶段。普通用户不可见，且不包含照片内容、EXIF、GPS 或存储路径。

## 媒体类型

- `IMAGE`：普通图片，保持旧版行为。
- `LIVE_PHOTO`：静态封面 + 短视频。旧版 App 读取 `PostMedia.url` 得到静态封面；新版客户端读取 `mediaType` 与 `videoUrl` 后播放。

## 上传流程

### 1. 创建上传任务并上传资源

`POST /api/media/live-photo`（`multipart/form-data`）

| 字段 | 说明 |
| --- | --- |
| `cover` | 必填。JPEG/HEIC/HEIF 静态封面，或带嵌入视频的 Motion Photo。 |
| `video` | 可选。MOV/MP4 配对视频；手动配对时必填。 |
| `requestId` | 客户端幂等键，建议 UUID。最终键由用户 ID、requestId 与文件哈希组成。 |
| `manual` | `"1"` 表示用户明确手动配对，不需要 Apple 原始配对标识。 |

响应 `202`：

```json
{
  "asset": {
    "id": "2f5c…",
    "status": "PROCESSING",
    "pairing": "MANUAL",
    "durationMs": 3200,
    "coverUrl": "/api/media/live-photo/2f5c…/cover",
    "videoUrl": "/api/media/live-photo/2f5c…/video"
  }
}
```

服务端会读取真实容器、MP4 时长与画面尺寸，超限直接拒绝，不自动截断。原始文件与转码结果均为私有对象，未审核前无法通过公开 CDN 访问。

### 2. 查询处理进度

`GET /api/media/live-photo/{assetId}`

返回同一个 `asset` 对象；`status` 为 `PENDING | PROCESSING | READY | FAILED | CANCELLED`。失败时返回 `errorCode`。

### 3. 取消 / 删除未使用媒体

- `POST /api/media/live-photo/{assetId}/cancel`
- `DELETE /api/media/live-photo/{assetId}`

已被帖子或草稿引用的媒体返回 `STILL_REFERENCED`（409），不会误删资源。

### 4. 读取媒体

- `GET /api/media/live-photo/{assetId}/cover`：静态封面。
- `GET /api/media/live-photo/{assetId}/video`：动态视频，支持 HTTP Range。

已审核公开帖子返回 `public, max-age=31536000, immutable`；未审核或私有状态返回 `private, no-store`，并通过登录/审核权限校验后才返回内容。

### 5. 发帖关联媒体

`POST /api/posts` 或 `PATCH /api/posts/{postId}` 的 `imageUrls` 数组中，实况照片使用标记：

```json
{ "imageUrls": ["https://media.ecfc.fans/media/.../normal.webp", "[[live-photo:2f5c…]]"] }
```

一个标记占一个媒体位置，与图片共用 9 个上限。服务端在事务内校验 `READY` 状态、所有权与引用权限，再写入 `PostMedia(type=LIVE_PHOTO, livePhotoId=…)`。

### 6. 查询帖子媒体

帖子详情/编辑/审核接口返回的 `media[]` 中，实况照片包含：

```json
{
  "id": "postMediaId",
  "type": "LIVE_PHOTO",
  "mediaType": "LIVE_PHOTO",
  "url": "/api/media/live-photo/{assetId}/cover",
  "thumbnail": "/api/media/live-photo/{assetId}/cover",
  "videoUrl": "/api/media/live-photo/{assetId}/video",
  "width": 1080,
  "height": 1920
}
```

## 旧版 App 兼容

- 旧版本不识别的新字段会被忽略；`url` 仍是静态封面地址。
- 当配置了 `NEXT_PUBLIC_APP_URL` 时，服务端返回的 `url` / `coverUrl` / `videoUrl` 为**绝对地址**（例如 `https://ecfc.fans/api/media/live-photo/{assetId}/cover`），旧版客户端可直接渲染，无需自行拼接域名。
- 旧版图片上传与帖子解析路径未变更。
- 不依赖 App 端升级；未来接入时只需按上述接口替换原生相册读取与上传步骤。
- 旧版客户端不发 `videoUrl` 请求时不会下载任何动态资源，只展示静态封面。

##  iOS / Android 接入建议

1. iOS 通过 `PHLivePhoto` 分别导出照片与 `PHVideoRequestOptions` 视频资源，调用本接口手动配对；若导出文件保留 Apple 配对标识，服务端会自动识别为 `APPLE`。
2. Android 通过相册文件读取 Motion Photo；若浏览器/文件接口能取得嵌入 MP4，服务端自动解析 `MOTION_PHOTO`。仅取得静态照片时，应fallback 为普通图片上传。
3. 上传后轮询 `READY` 再关联帖子；不要在未完成时发布。

## Web 端展示约定（所有帖子页面共用）

- 帖子媒体只有一处类型白名单：`lib/post-media-core.ts` 的 `POST_MEDIA_VISIBLE_TYPES = ['IMAGE', 'LIVE_PHOTO']`。
  任何页面（广场、详情、分享卡、最近动态）都不得再单独写 `type: 'IMAGE'`：实况照片的 `url` 同时就是静态封面，一旦被类型过滤掉，页面不是退化成静态图，而是**整张图片消失**。
- 渲染前统一经 `toPostMediaDisplayItems()` 归一化一次，输出 `{ mediaType, coverUrl, videoUrl, width, height, sortOrder }`：
  - `coverUrl` 永远可渲染，与动态资源是否可播放无关；
  - 仅当 `LIVE_PHOTO` 且能解析出合法 assetId 时才给出 `videoUrl`，否则是 `null`（不伪造可播放状态）；
  - 重复的同一 media 只渲染一次，保持作者原始顺序。
- 旧帖子无需重新发布：只要 `PostMedia` 行与 `LivePhoto` 关联仍在，代码修复即自动恢复展示；不会重新转码已 `READY` 的资源。

## 移动端浏览器能力边界

- `accept="image/*"` 是所有 Android / 微信构建唯一稳定映射到相册的取值；MIME + 扩展名长列表会退回“档案/文件”选择器。
- iOS 原生相册选择器内部的 LIVE 标识由系统绘制，Web 无法控制；`<input type="file">` 只交回静态照片（HEIC/JPEG），不会附带配对 MOV。因此 iOS Safari / iOS 微信只能上传静态照片，这不是本项目的缺陷，也不得用静态图伪造实况。
- Android 的 Motion Photo 是**自带嵌入视频的 JPG**，不需要选择器接受 MOV/MP4；服务端负责提取与转码。
