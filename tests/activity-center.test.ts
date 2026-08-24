import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { getActivityDisplayStatus, parseActivityDateInput, sortActivities } from '@/lib/activity'
import { storedActivityImageUrl } from '@/lib/activity-image-url'
import { createActivityViewKey, recordActivityView, shouldCountActivityView } from '@/lib/activity-views'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('活动状态根据发布状态和北京时间动态计算，不需要定时任务', () => {
  const now = new Date('2026-08-20T04:00:00.000Z')
  assert.equal(getActivityDisplayStatus({ status: 'PUBLISHED', startsAt: '2026-08-20T03:00:00.000Z', endsAt: '2026-08-20T06:00:00.000Z' }, now), 'ONGOING')
  assert.equal(getActivityDisplayStatus({ status: 'PUBLISHED', startsAt: '2026-08-20T06:00:00.000Z', endsAt: '2026-08-20T07:00:00.000Z' }, now), 'UPCOMING')
  assert.equal(getActivityDisplayStatus({ status: 'PUBLISHED', startsAt: '2026-08-19T03:00:00.000Z', endsAt: '2026-08-19T06:00:00.000Z' }, now), 'ENDED')
  assert.equal(getActivityDisplayStatus({ status: 'CANCELLED', startsAt: '2026-08-20T03:00:00.000Z', endsAt: null }, now), 'CANCELLED')
  assert.equal(getActivityDisplayStatus({ status: 'DRAFT', startsAt: null, endsAt: null }, now), 'DRAFT')
})

test('datetime-local 输入按 Asia/Shanghai 解析', () => {
  assert.equal(parseActivityDateInput('2026-08-20T10:00')?.toISOString(), '2026-08-20T02:00:00.000Z')
  assert.equal(parseActivityDateInput('2026-02-31T10:00'), null)
})

test('活动排序遵循置顶、动态状态、排序值、开始时间、创建时间', () => {
  const now = new Date('2026-08-20T04:00:00.000Z')
  const base = { status: 'PUBLISHED' as const, endsAt: null, isPinned: false, sortOrder: 0, createdAt: '2026-08-19T00:00:00.000Z' }
  const sorted = sortActivities([
    { ...base, id: 'ended', startsAt: '2026-08-18T00:00:00.000Z', endsAt: '2026-08-19T00:00:00.000Z' },
    { ...base, id: 'upcoming', startsAt: '2026-08-20T06:00:00.000Z' },
    { ...base, id: 'pinned', startsAt: '2026-08-22T06:00:00.000Z', isPinned: true },
  ], now)
  assert.deepEqual(sorted.map((item) => item.id), ['pinned', 'upcoming', 'ended'])
})

test('活动图片只接受活动上传端生成的 source.webp 地址', () => {
  assert.match(storedActivityImageUrl('https://ecfc-1306412725.cos.ap-guangzhou.myqcloud.com/activities/a/source.webp') || '', /\/activities\/a\/source\.webp$/)
  assert.equal(storedActivityImageUrl('https://example.com/activities/a/source.webp'), null)
  assert.equal(storedActivityImageUrl('https://ecfc-1306412725.cos.ap-guangzhou.myqcloud.com/activities/a/card.webp'), null)
})

test('活动浏览量按访客和活动短期去重，详情页通过计数接口更新', () => {
  const key = createActivityViewKey('activity-1', 'user:user-1')
  const now = Date.parse('2026-08-20T04:00:00.000Z')
  const history = recordActivityView({}, key, now)
  assert.equal(shouldCountActivityView(history, key, now + 60_000), false)
  assert.equal(shouldCountActivityView(history, key, now + 20 * 60_000 + 1), true)
  assert.match(read('app/api/activities/[activityId]/view/route.ts'), /viewCount: { increment: 1 }/)
  assert.match(read('components/activities/ActivityViewCounter.tsx'), /method: 'POST'/)
})

test('活动后台接口包含服务端权限、审计和删除保护', () => {
  const collectionRoute = read('app/api/admin/activities/route.ts')
  const detailRoute = read('app/api/admin/activities/[activityId]/route.ts')
  const uploadRoute = read('app/api/uploads/activity-image/route.ts')
  const imageRules = read('lib/activity-image.ts')
  assert.match(collectionRoute, /requireAdmin\('activity_manage'\)/)
  assert.match(detailRoute, /requireAdmin\('activity_manage'\)/)
  assert.match(detailRoute, /ACTIVITY_CREATE|ACTIVITY_UPDATE/)
  assert.match(detailRoute, /ActivityRegistration: true/)
  assert.match(detailRoute, /status !== 'DRAFT'/)
  assert.match(detailRoute, /status: 404/)
  assert.match(imageRules, /5 \* 1024 \* 1024/)
  assert.match(uploadRoute, /requireAdmin\('activity_manage'\)/)
})

test('活动公开详情保留已取消活动，草稿不会泄露', () => {
  const publicDetail = read('app/api/activities/[activityId]/route.ts')
  const publicList = read('app/api/activities/route.ts')
  const publicPage = read('app/activities/[activityId]/page.tsx')
  assert.match(publicDetail, /status: \{ in: \['PUBLISHED', 'CANCELLED'\] \}/)
  assert.match(publicList, /const publicDatabaseStatuses: ActivityStatusValue\[\] = \['PUBLISHED'\]/)
  assert.match(publicDetail, /status: 404/)
  assert.match(publicPage, /where: \{ id: activityId, status: 'PUBLISHED' \}/)
  assert.match(publicPage, /status: 'CANCELLED'/)
})

test('活动迁移将旧状态归一化并保留报名/收藏关联保护所需字段', () => {
  const migration = read('prisma/migrations/20260825090000_add_activity_center/migration.sql')
  assert.match(migration, /CONCERT_SIGNUP.*CONCERT/)
  assert.match(migration, /CLOSED.*FINISHED/)
  assert.match(migration, /ENUM\('DRAFT', 'PUBLISHED', 'CANCELLED'\)/)
  assert.match(migration, /ADD COLUMN `createdById`/)
  assert.match(migration, /ADD COLUMN `viewCount`/)
})
