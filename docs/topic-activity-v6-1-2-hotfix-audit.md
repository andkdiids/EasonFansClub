# Topic Activity V6.1.2 hotfix audit

## Isolation and release evidence

- Production health was read twice during this task and returned release `635ae4a0e1d8eae9d93420517a17f4b29794896f`.
- V6.1.1 remote branch is `release/topic-activity-hotfix-v6-1-1`, HEAD `c741a46604b911bbfc2d6c137da86d89846b91e3`. It is **not deployed** according to those health checks.
- Candidate branch: `release/topic-activity-hotfix-v6-1-2`; clean starting HEAD/base: `c741a46604b911bbfc2d6c137da86d89846b91e3`, so all V6.1.1 fixes are included.
- Worktree: `C:\Users\Eason\Documents\私家E院\worktrees\ecfc-topic-activity-hotfix-v6-1-2`.
- Fresh detached A/B baseline: `C:\Users\Eason\Documents\私家E院\worktrees\ecfc-topic-activity-v612-baseline`, also at `c741a466...`.
- No Mobile/Cantonese source changes, no schema/version/configuration changes, no production database reads or writes, no deployment or migration execution.
- Repository migration directory count is 171 in both baseline and candidate. This is a repository comparison, **not a fresh production database migration diagnostic**.

## Root causes and fixes

### Form queue

The endpoint and queue previously supported descending pagination and repeated single-page loading. The server now supports `sort=OLDEST|NEWEST`, default OLDEST, ordered by actual `submittedAt` and `id` together. Cursor comparisons use the matching direction; new cursors include the sort and mismatched cursors are rejected. Existing untagged cursor decoding remains supported.

The manager resets its cursor/selection on sort or filter changes, preserves activity and reply filtering, and drains bounded pages of 20 records from one click. It deduplicates IDs, shows progress, allows stopping, times out list requests after 45 seconds, and retains loaded records/cursor on interruption for retry. Rendering yields between pages; collapsed rows use content visibility, lazy avatars, and selected-only expensive detail rendering. A 1,000-record safety limit directs administrators to narrow the reply filter. Bulk loading issues GET requests only. Replies still use the existing idempotent local-update/auto-next flow, not a page reload.

### Private image stability

Code evidence: `serializeTopicActivityAsset` emits 300-second signed COS URLs; loaded rows retained these URLs without renewal. This explains a reproducible expiry boundary in a long-lived queue, but **the failing production image HTTP status was not captured**. No claim is made that a production 401/403 or COS outage was observed.

Web now prefers additive `previewAccessUrl` / `thumbnailAccessUrl` fields, keyed by asset ID through `GET /api/activities/:activityId/assets/:assetId/preview`. Every request rechecks canonical Cookie/Bearer identity, activity/asset scope, uploader/submission-owner/activity-manage permission, and the approved private derivative namespace. Unauthorized cross-user/cross-activity requests return 404; anonymous requests remain 401. Responses are private/no-store and never expose a permanent public URL or source image bytes.

Modern original-image derivative layouts and historical topic `source.webp` derivative layouts are supported without rewriting stored references. Unknown historical layouts retain the existing short-lived URL fallback; no unsupported object path is guessed. Existing absolute signed `url`/`thumbnailUrl` fields are unchanged for Mobile clients that load them directly without an Authorization header. Only the narrow new GET preview path is added to Bearer middleware compatibility.

Preview failures allow one automatic retry, then show “图片加载失败 / 重新加载图片”. A manual retry uses a fresh same-origin authenticated request. Original downloading remains separate and byte-preserving with existing permission checks; Blob lifetime and stale/aborted request handling are guarded. No source bytes are recompressed or reencoded.

### Comment upload feedback

Code evidence: ReplyForm only observed successful URLs, not the uploader's queued/failed state. Browser decoding/canvas/network operations lacked a combined bounded deadline; unsupported browser HEIC decoding had no server fallback. These are code-level failure paths, not proof that every reported production failure had one particular format.

The uploader now exposes pending/failed state and immediate ref-based checks; comments cannot submit pending or failed images before or after an asynchronous confirmation. Per-image queued/processing/compressing/uploading/success/failure feedback, 60-second preparation/upload deadline, abort cleanup, three explicit retry maximum, per-item request locks, and nine-image retry capacity checks preserve successful images and text drafts. Existing format, file-size, compression, clipboard, image-editing and attachment permission rules remain in effect.

The existing content-image upload route now returns a request trace header and logs only bounded safe stage/code/status/type/size metadata. Storage and unexpected exception text is not disclosed. Auth/rate-limit/size/decode/format/conversion/storage/network errors are visible and retryable where appropriate. Comment attachment authorization remains enforced by the existing comment endpoint.

HEIC/HEIF browser fallback uses the existing server Sharp decoder. Automated route fixtures cover HEIC/HEIF-labelled AV1/HEIF containers and explicit undecodable-image failures, **not real iPhone HEVC photos**. Real-device HEIC/HEIF codec coverage and provider upload remain pending; no new decoder dependency or format-policy change is claimed.

## Verification

Both full runs used Windows, Node `v24.18.0`, pnpm `11.7.0`, the same unchanged locked dependencies/generated Prisma client, `NODE_ENV=test`, a deliberately unreachable local database fixture address, and:

```text
node --import tsx --test --test-concurrency=4 --test-reporter=tap tests/*.test.ts
```

`pnpm_config_verify_deps_before_run=false` prevents pnpm from attempting dependency reinstallation inside source-contract tests; this is a process environment setting, not a committed package configuration change. Baseline uses a junction to this candidate's own isolated dependency installation, not a dependency directory belonging to another dirty worktree.

| Verification | Result |
| --- | --- |
| Fresh baseline | 3780 total: 3757 pass, 19 fail, 4 skip |
| Final candidate | 3802 total: 3779 pass, 17 fail, 6 skip |
| Failure comparison by test file + name | 0 new failures; 2 fixed stale-clock fixture failures |
| Directed topic/upload/auth/permission/regression tests | 142/142 PASS |
| Upload route after final test type corrections | 8/8 PASS |
| Actual React local Edge browser fixtures | 19/19 PASS; no skips |
| TypeScript, nonincremental | PASS |
| Next lint | PASS, 0 errors, 120 warnings |
| Prisma validate / generate | PASS; own isolated client; no database connection |
| Production build | PASS, including page generation/build tracing |
| Diff / migration diff | PASS; no schema/migration changes |
| Changed-file sensitive scan | 0 credential matches; no environment/native/build artifacts |

The full suite is **not entirely green**. These 17 candidate failures also occur in the fresh baseline:

1. `badge-effects.test.ts` — museum and mini showcase keep GLOW on the badge image instead of the shelf item
2. `birthday-first-set-flow.test.ts` — CASE 8: saving other profile fields with an incomplete birthday omits birthday fields
3. `forum-discovery.test.ts` — 移动端小臣书帖子详情底栏：DOM=最终顺序（说点什么→点赞→收藏→评论）且不再依赖失效的 CSS order
4. `friend-chat-sticker-focus.test.ts` — sticker sends use an explicit source, blur before closing, and preserve the text draft
5. `friend-chat-sticker-focus.test.ts` — message updates do not globally refocus the composer, while sticker completion settles focus and scrolls latest
6. `friend-display-name.test.ts` — 通知和游戏邀请只在本地好友语境使用备注，房间/排行榜仍用公开昵称
7. `friend-list-scroll-restoration.test.ts` — opening chat saves the anchor before asynchronous conversation loading
8. `friend-list-scroll-restoration.test.ts` — the list waits for normal and grouped data before restoring
9. `friend-list-scroll-restoration.test.ts` — search state is part of the return record and is not silently replaced
10. `navigation-notification-profile-card.test.ts` — 通知头像阻止冒泡，正文仍保留原跳转行为
11. `navigation-notification-profile-card.test.ts` — 资料卡五种关系状态使用统一的状态文案和操作入口
12. `post-badge-display.test.ts` — 共用勋章显示组件默认不限制数量，并按既有 position 顺序截取场景上限
13. `production-incremental-candidate.test.ts` — production incremental candidate is scoped to Anywhere Door tables
14. `production-incremental-candidate.test.ts` — production incremental candidate includes current safety state and log fields
15. `production-incremental-candidate.test.ts` — production incremental candidate preserves MySQL and User FK compatibility
16. `topic-activity-hotfix-v4.test.ts` — Topic Activity UI 回归保护既有活动模型和 migration，允许其他模块的 additive migration
17. `want-listen-availability.test.ts` — 下一题生成在交互事务内复用同一个 Prisma 客户端，避免额外占用连接池

The three incremental-candidate failures depend on an absent ignored `tmp/PRODUCTION_INCREMENTAL_CANDIDATE.sql`; no temporary SQL is committed to mask them. The V4 migration test's child Git invocation fails in the elevated test identity context in both runs; direct schema/migration diff is empty. Remaining pre-existing source-contract failures are outside this hotfix.

Two baseline failures in `topic-activity-v6-comment-route.test.ts` used an activity window ending before the real test date. The candidate pins only that fixture's Date clock and restores it afterward. Production time-window logic is unchanged.

Browser coverage includes oldest/newest/filter/cursor reset, 65-record drain and interrupted resume, 1,020-record safety-cap fixture, no write requests during draining, non-resetting reply queue, original-byte hash comparison, bounded auth failure/recovery, actual rendered image naturalWidth, IMAGE/global/reply rendering, pending/error upload gates, duplicate retry locking, nine-image capacity, and V6.1.1 actual sheet/dialog/filter/count behavior. User-agent simulation is **not physical Android WeChat or iOS Safari QA**.

Local evidence logs are outside the repository under `C:\Users\Eason\Documents\私家E院\tmp\topic-v612-*`; they are not commit inputs.

## Commit scope (27 files)

Runtime (16):

- `app/admin/activities/TopicActivityFormSubmissionManager.tsx`
- `app/api/admin/activities/[activityId]/form-submissions/route.ts`
- `app/api/activities/[activityId]/assets/[assetId]/preview/route.ts`
- `app/api/uploads/content-image/route.ts`
- `components/ContentImageUploader.tsx`
- `components/ReplyForm.tsx`
- `components/activities/TopicActivityFormParticipation.tsx`
- `components/activities/TopicActivityImagePicker.tsx`
- `components/activities/TopicActivityOriginalImage.tsx`
- `components/activities/TopicActivityAssetImage.tsx`
- `lib/content-image-browser.ts`
- `lib/content-image-upload.ts`
- `lib/topic-activity-assets.ts`
- `lib/topic-activity-form-cursor.ts`
- `lib/topic-activity-image-preview.ts`
- `middleware.ts`

Tests (10):

- `tests/content-image-upload-fix.test.ts`
- `tests/content-image-route-v612.test.ts`
- `tests/content-image-uploader-v612-browser.test.ts`
- `tests/middleware-auth.test.ts`
- `tests/post-clipboard-attachments.test.ts`
- `tests/topic-activity-v6-comment-route.test.ts`
- `tests/topic-activity-v61-browser.test.ts`
- `tests/topic-activity-v61-pagination.test.ts`
- `tests/topic-activity-v612-media-browser.test.ts`
- `tests/topic-activity-v612-media-stability.test.ts`

Report (1): `docs/topic-activity-v6-1-2-hotfix-audit.md`.

## Release handoff

- Android WeChat physical QA: PENDING.
- iOS Safari physical QA: PENDING.
- Real provider upload / original private COS bytes / genuine HEVC HEIC photos: PENDING physical/provider verification; automated COS operations use stubs.
- Recheck actual production code and migrations before any separately approved release. This branch includes an undeployed V6.1.1 RC.
- Commit/push only this branch after the above checks. Deploy: NO. Production write: 0. Migration execution: NO. APK: NO.
