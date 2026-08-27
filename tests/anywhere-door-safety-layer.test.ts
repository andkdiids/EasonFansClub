import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getAnywhereDoorConfig, buildInstagramMediaStorageKey } from '@/lib/anywhere-door/config'
import { runAnywhereDoorProductionPreflight } from '@/lib/instagram/production-preflight'
import { calculateFailureBackoffMinutes, calculateNextAllowedAfterFailure, withTimeout } from '@/lib/instagram/sync-policy'
import { buildSocialPostNotificationBatch } from '@/lib/instagram/sync-service'
import { MockInstagramMediaLocalizer } from '@/lib/instagram/media'
import { acquireInstagramSyncLease, buildInstagramSyncLockKey, releaseInstagramSyncLease } from '@/lib/instagram/sync-state'
import { filterEcenterFeaturesForUser, mergeEcenterFeatureSettings } from '@/lib/ecenter-features'

const root = process.cwd()
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

test('Anywhere Door flags and storage mode fail closed by default', () => {
  const config = getAnywhereDoorConfig({})
  assert.equal(config.enabled, false)
  assert.equal(config.syncEnabled, false)
  assert.equal(config.notificationEnabled, false)
  assert.equal(config.storageMode, 'poc')
  assert.equal(getAnywhereDoorConfig({ ANYWHERE_DOOR_STORAGE_MODE: 'unexpected' }).storageMode, null)
  assert.equal(getAnywhereDoorConfig({ ANYWHERE_DOOR_STORAGE_MODE: 'PRODUCTION' }).storageMode, 'production')
})

test('navigation registry hides the feature for ordinary users while retaining admin management', () => {
  const previous = process.env.ANYWHERE_DOOR_ENABLED
  delete process.env.ANYWHERE_DOOR_ENABLED
  try {
    const features = mergeEcenterFeatureSettings()
    assert.equal(filterEcenterFeaturesForUser(features, false).some((feature) => feature.featureKey === 'ANYWHERE_DOOR'), false)
    assert.equal(filterEcenterFeaturesForUser(features, true).some((feature) => feature.featureKey === 'ANYWHERE_DOOR'), true)
  } finally {
    if (previous === undefined) delete process.env.ANYWHERE_DOOR_ENABLED
    else process.env.ANYWHERE_DOOR_ENABLED = previous
  }
})

test('storage key builder keeps POC and production prefixes separate', () => {
  const input = { username: 'mreasonchan', externalId: 'abc123', kind: 'image' as const, sortOrder: 0 }
  assert.equal(buildInstagramMediaStorageKey({ ...input, mode: 'poc' }), 'social/instagram/mreasonchan/poc/abc123/image-01.webp')
  assert.equal(buildInstagramMediaStorageKey({ ...input, mode: 'production' }), 'social/instagram/mreasonchan/abc123/image-01.webp')
  assert.doesNotMatch(buildInstagramMediaStorageKey({ ...input, mode: 'production' }), /\/poc\//)
})

test('worker failure policy applies bounded backoff and Retry-After', () => {
  assert.equal(calculateFailureBackoffMinutes(1), 30)
  assert.equal(calculateFailureBackoffMinutes(2), 60)
  assert.equal(calculateFailureBackoffMinutes(3), 180)
  assert.equal(calculateFailureBackoffMinutes(10), 360)
  const now = new Date('2026-08-27T00:00:00.000Z')
  assert.equal(calculateNextAllowedAfterFailure({ now, consecutiveFailures: 1, errorCode: 'PROVIDER_RATE_LIMITED', retryAfterSeconds: 90 }).toISOString(), '2026-08-27T00:01:30.000Z')
  assert.equal(calculateNextAllowedAfterFailure({ now, consecutiveFailures: 1, errorCode: 'PROVIDER_RATE_LIMITED' }).getTime() - now.getTime(), 6 * 60 * 60 * 1000)
})

test('worker timeout is explicit and releases its timer', async () => {
  await assert.rejects(withTimeout(new Promise(() => undefined), 5), /SYNC_TIMEOUT/)
  assert.equal(buildInstagramSyncLockKey(), 'anywhere-door-instagram-sync:mreasonchan')
})

test('database lease prevents a second worker from running concurrently', async () => {
  const state = {
    id: 'state-1', platform: 'INSTAGRAM' as const, target: 'mreasonchan', lockToken: null as string | null,
    lockUntil: null as Date | null,
  }
  const db = {
    socialSyncState: {
      findUnique: async () => state,
      create: async () => state,
      findUniqueOrThrow: async () => state,
      updateMany: async ({ where, data }: { where: { id: string; OR?: Array<{ lockUntil: null } | { lockUntil: { lt: Date } }>; lockToken?: string }; data: { lockToken: string | null; lockUntil: Date | null } }) => {
        const expiryCondition = where.OR?.find((condition) => typeof condition.lockUntil === 'object' && condition.lockUntil !== null)
        const queryNow = expiryCondition && typeof expiryCondition.lockUntil === 'object' ? expiryCondition.lockUntil.lt : new Date()
        const available = !state.lockUntil || state.lockUntil < queryNow
        const ownsToken = !where.lockToken || state.lockToken === where.lockToken
        if (where.OR && (!available || !ownsToken)) return { count: 0 }
        state.lockToken = data.lockToken
        state.lockUntil = data.lockUntil
        return { count: 1 }
      },
    },
    socialSyncLog: {
      count: async () => 0,
      findFirst: async () => null,
    },
  } as never
  const now = new Date('2026-08-27T00:00:00.000Z')
  const first = await acquireInstagramSyncLease({ db, now, token: 'worker-a' })
  const second = await acquireInstagramSyncLease({ db, now, token: 'worker-b' })
  assert.equal(first.acquired, true)
  assert.equal(second.acquired, false)
  assert.equal(await releaseInstagramSyncLease('mreasonchan', 'worker-a', db), true)
})

test('production preflight rejects a Mock localizer without revealing secrets', () => {
  const env = {
    NODE_ENV: 'production', IG_PROVIDER: 'apify', APIFY_API_TOKEN: 'configured',
    TENCENT_COS_SECRET_ID: 'configured', TENCENT_COS_SECRET_KEY: 'configured',
    TENCENT_COS_BUCKET: 'ecfc-1306412725', TENCENT_COS_REGION: 'ap-guangzhou',
    ANYWHERE_DOOR_STORAGE_MODE: 'production',
  }
  const result = runAnywhereDoorProductionPreflight(env, { localizer: new MockInstagramMediaLocalizer() })
  assert.equal(result.ok, false)
  assert.ok(result.issues.includes('UNSAFE_MEDIA_LOCALIZER'))
  assert.equal(JSON.stringify(result).includes('configured'), false)
})

test('notification batch aggregates and has a stable idempotency key', () => {
  const first = buildSocialPostNotificationBatch(['post-b', 'post-a', 'post-a'], 'mreasonchan', ['user-1'])
  const second = buildSocialPostNotificationBatch(['post-a', 'post-b'], 'mreasonchan', ['user-1'])
  assert.equal(first.length, 1)
  assert.equal(first[0]?.title, '陈奕迅更新了 2 条 Instagram 动态')
  assert.equal(first[0]?.link, '/anywhere-door')
  assert.equal(first[0]?.key, second[0]?.key)
})

test('navigation, admin sync and comments are guarded by the safety layer', () => {
  assert.match(read('lib/ecenter-features.ts'), /isAnywhereDoorEnabled\(\)/)
  assert.doesNotMatch(read('app/api/admin/anywhere-door/sync/route.ts'), /syncInstagramPosts/)
  assert.match(read('app/api/admin/anywhere-door/sync/route.ts'), /requestInstagramSync/)
  assert.doesNotMatch(read('app/api/anywhere-door/[postId]/comments/route.ts'), /take: 100/)
  assert.match(read('lib/social-posts.ts'), /take: take \+ 1/)
  assert.doesNotMatch(read('lib/social-posts.ts'), /sourceUrl:/)
  assert.match(read('ecosystem.config.js'), /instagram-sync-worker/)
})
