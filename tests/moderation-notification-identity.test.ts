import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  isModerationResultNotification,
  SYSTEM_REVIEW_SENDER_NAME,
  SYSTEM_REVIEW_SENDER_ROLE,
} from '../lib/moderation-notification-identity'

const read = (path: string) => readFileSync(path, 'utf8')

test('approval and rejection notices from every public moderation surface use the official identity', () => {
  const cases = [
    { type: 'ADMIN', key: 'post-review-result:post-1:APPROVED:1', link: '/posts/post-1' },
    { type: 'ADMIN', key: 'post-review-result:post-2:REJECTED:2', link: '/posts/post-2?from=notice' },
    { type: 'ADMIN', key: 'post-review:post-3:REJECTED:3', link: '/posts/post-3' },
    { type: 'ADMIN', key: 'salon-review:salon-1:APPROVED:1', link: '/salon/mine' },
    { type: 'ADMIN', key: 'salon-review:salon-2:REJECTED:2', link: '/salon/mine' },
    { type: 'ADMIN', key: 'sticker-pack-review:pack-1:approved:1', link: '/stickers/pack-1' },
    { type: 'ADMIN', key: 'sticker-pack-review:pack-2:rejected:2', link: '/profile/stickers/pack-2/edit' },
    { type: 'ADMIN', key: 'studio-review:project-1:APPROVED:1', link: '/studio/project/project-1' },
    { type: 'ADMIN', key: 'studio-review:project-2:REJECTED:2', link: '/studio/beads?project=project-2' },
    { type: 'ADMIN', key: 'creator-review:project-3:REJECTED:3', link: '/studio/project/project-3' },
    { type: 'ADMIN', key: 'post-review-result:post-4:REJECTED:4', link: null },
    { type: 'ADMIN', key: 'post-review:post-5:review-round', link: null },
    { type: 'ADMIN', key: 'salon-review:salon-3:APPROVED:7', link: null },
    { type: 'ADMIN', key: 'sticker-pack-review:pack-3:rejected:8', link: null },
    { type: 'ADMIN', key: 'studio-review:project-4:REJECTED:9', link: null },
    { type: 'ACTIVITY', key: 'topic-activity-review:submission:APPROVED:5', link: '/activities' },
    { type: 'SYSTEM', key: 'topic-v2-review:submission:REJECTED:6', link: '/activities/a' },
  ]

  for (const item of cases) assert.equal(isModerationResultNotification(item), true, JSON.stringify(item))
  assert.equal(SYSTEM_REVIEW_SENDER_NAME, '私家E院')
  assert.equal(SYSTEM_REVIEW_SENDER_ROLE, '系统审核通知')
})

test('moderation identity detection does not capture administrator queues or ordinary interactions', () => {
  const cases = [
    { type: 'REVIEW', key: 'post-review:post-1', link: '/admin/posts/review' },
    { type: 'ADMIN', key: 'post-review:post-1', link: '/admin/posts/review' },
    { type: 'ADMIN', key: 'sticker-pack-review:pack-1', link: '/admin/stickers' },
    { type: 'ADMIN', key: 'admin-message:1', link: '/posts/post-1' },
    { type: 'LIKE', key: null, link: '/posts/post-1' },
    { type: 'REPLY', key: null, link: '/posts/post-1' },
  ]
  for (const item of cases) assert.equal(isModerationResultNotification(item), false, JSON.stringify(item))
})

test('API DTO replaces moderator actor data for historical results and skips reviewer profile hydration', () => {
  const notifications = read('lib/notifications.ts')
  assert.match(notifications, /isModerationResultNotification\(item\)\s*\?\s*\[\]\s*:/)
  assert.match(notifications, /const actor = moderationResult \? null : item\.User_Notification_actorIdToUser/)
  assert.match(notifications, /actorName,\s*actorRole: moderationResult \? SYSTEM_REVIEW_SENDER_ROLE : null/)
  assert.match(notifications, /actorUid: actor\?\.uid \|\| null/)
  assert.match(notifications, /actorAvatarUrl: publicImageUrl\(actor\?\.Profile\?\.avatarUrl \|\| actor\?\.avatarUrl\)/)
  assert.match(notifications, /actorProfile,\s*actorUnavailable: Boolean\(actor && !actorProfile\)/)

  const client = read('app/notifications/NotificationsClient.tsx')
  assert.match(client, /item\.actorRole \? <p className="[^"]+"><strong>\{item\.actorName \|\| '私家E院'\}<\/strong><span>\{item\.actorRole\}<\/span><\/p>/)
  assert.match(client, /siteLogoUrl \? \(/)

  const apiRoute = read('app/api/notifications/route.ts')
  assert.match(apiRoute, /getSiteAppearance\(\)/)
  assert.match(apiRoute, /actorRole === '系统审核通知'\s*\? \{ \.\.\.item, actorAvatarUrl: reviewAvatarUrl \}/)
  assert.match(apiRoute, /notifications,\s*items: notifications/)
})

test('reviewer audit data remains stored while the public DTO removes actor fields', () => {
  const post = read('app/api/admin/posts/review/route.ts')
  assert.match(post, /actorId:\s*input\.operatorId/)
  assert.match(post, /writeReviewAudit\(\{[\s\S]*?operatorId: guard\.user\.id/)
  const sticker = read('lib/sticker-center.ts')
  assert.match(sticker, /actorId:\s*input\.reviewerId/)
  const dto = read('lib/notifications.ts')
  assert.match(dto, /const actor = moderationResult \? null : item\.User_Notification_actorIdToUser/)
  assert.match(dto, /actorUid: actor\?\.uid \|\| null/)
  assert.match(dto, /actorProfile,\s*actorUnavailable: Boolean\(actor && !actorProfile\)/)
})
