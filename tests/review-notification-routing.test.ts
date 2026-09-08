import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildReviewCenterUrl } from '../lib/review-center'
import { getNotificationTarget, getReviewNotificationTarget } from '../lib/notification-target'

const read = (path: string) => readFileSync(path, 'utf8')

function notification(input: Partial<{
  type: string
  link: string | null
  key: string | null
}> = {}) {
  return {
    id: 'review-notification-test',
    source: 'personal' as const,
    type: input.type || 'REVIEW',
    link: input.link ?? null,
    targetUrl: null,
    key: input.key ?? null,
  }
}

test('所有统一审核类型都生成审核中心深链，并保留具体目标', () => {
  const cases = [
    ['POST', 'post-1', '/admin/review?type=post&targetId=post-1'],
    ['SALON', 'salon-1', '/admin/review?type=salon&targetId=salon-1'],
    ['CREATION', 'project-1', '/admin/review?type=creation&targetId=project-1'],
    ['STICKER', 'pack-1', '/admin/review?type=sticker&targetId=pack-1'],
    ['CONCERT', 'contribution-1', '/admin/review?type=concert&targetId=contribution-1'],
    ['TODAY', 'event-1', '/admin/review?type=today&targetId=event-1'],
  ] as const

  for (const [type, targetId, expected] of cases) {
    assert.equal(buildReviewCenterUrl(type, targetId), expected)
  }
})

test('新旧审核通知都一步进入统一审核中心，历史 key/link 可恢复分类和目标', () => {
  const cases = [
    ['post', '/admin/posts/review', 'post-review:post-1:edit-round', '/admin/review?type=post&targetId=post-1'],
    ['salon', '/admin/salon?postId=salon-1', 'salon-review:salon-1', '/admin/review?type=salon&targetId=salon-1'],
    ['creation', '/admin/studio?projectId=project-1', 'creator-review:project-1:round-1', '/admin/review?type=creation&targetId=project-1'],
    ['sticker', '/admin/stickers', 'sticker-pack-review:pack-1', '/admin/review?type=sticker&targetId=pack-1'],
    ['sticker-resubmit', '/admin/stickers', 'sticker-pack-resubmit:pack-2:attempt-1', '/admin/review?type=sticker&targetId=pack-2'],
    ['today', '/admin/today', 'today-review:event-1', '/admin/review?type=today&targetId=event-1'],
    ['concert', '/admin/music/concerts/contributions?submission=contribution-1', null, '/admin/review?type=concert&targetId=contribution-1'],
  ] as const

  for (const [, link, key, expected] of cases) {
    assert.equal(getNotificationTarget(notification({ link, key })), expected)
  }

  assert.equal(getNotificationTarget(notification({ type: 'REVIEW' })), '/admin/review')
  assert.equal(getNotificationTarget(notification({ type: 'ADMIN', link: '/admin/salon?postId=salon-2', key: null })), '/admin/review?type=salon&targetId=salon-2')
  assert.equal(getReviewNotificationTarget(notification({ type: 'ADMIN', link: '/profile/stickers/pack-1', key: 'sticker-pack-review:pack-1:approved' })), null)
  assert.equal(getNotificationTarget(notification({ type: 'ADMIN', link: '/admin/stickers', key: null })), '/admin/stickers')
  assert.equal(getNotificationTarget(notification({ type: 'ADMIN', link: '/admin/studio', key: 'sticker-pack-review:pack-1' })), '/admin/studio')
  assert.equal(getNotificationTarget(notification({ type: 'ADMIN', link: null, key: 'sticker-pack-review:pack-1:approved' })), '/profile/stickers')
})

test('普通通知不进入审核中心，审核中心支持一次性 targetId 定位和已处理状态', () => {
  assert.equal(getNotificationTarget(notification({ type: 'REPLY', link: '/posts/post-1', key: null })), '/posts/post-1')
  assert.equal(getNotificationTarget(notification({ type: 'ADMIN', link: '/profile/stickers/pack-1', key: 'sticker-pack-review:pack-1:approved' })), '/profile/stickers/pack-1')

  const page = read('app/admin/review/page.tsx')
  const center = read('app/admin/review/ReviewCenter.tsx')
  const route = read('app/api/admin/review/route.ts')
  assert.match(page, /initialTargetId/)
  assert.match(center, /initialTargetId \? 'ALL' : 'PENDING'/)
  assert.match(center, /data-review-target/)
  assert.match(center, /scrollIntoView/)
  assert.match(route, /targetId = sanitizeText/)
  assert.match(route, /targetFound:/)
})

test('新审核通知源统一写入 canonical review-center URL', () => {
  const sources = [
    'app/api/posts/route.ts',
    'app/api/posts/[postId]/route.ts',
    'lib/salon-review-notifications.ts',
    'lib/studio/review-notifications.ts',
    'app/api/stickers/my/[packId]/submit/route.ts',
    'lib/sticker-center.ts',
    'app/api/today/route.ts',
  ]
  for (const source of sources) assert.match(read(source), /buildReviewCenterUrl/)
})
