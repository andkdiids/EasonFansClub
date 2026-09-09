import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { activityNotificationLink, getActivityNotificationAudience, normalizeActivityNotificationInput } from '../lib/activity-notification'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

test('activity notification audience is resolved from the activity registrations and deduped by user', async () => {
  let registrationWhere: unknown = null
  const db = {
    activity: {
      findUnique: async () => ({ id: 'activity-1', title: '活动 A', status: 'PUBLISHED' }),
    },
    activityRegistration: {
      findMany: async (args: { where: unknown }) => {
        registrationWhere = args.where
        return [{ userId: 'user-1', id: 'r1' }, { userId: 'user-1', id: 'r2' }, { userId: 'user-2', id: 'r3' }]
      },
    },
  }
  const audience = await getActivityNotificationAudience(db as never, 'activity-1')
  assert.deepEqual(audience?.userIds, ['user-1', 'user-2'])
  assert.deepEqual(registrationWhere, {
    activityId: 'activity-1',
    status: { in: ['ACTIVE'] },
    User: { status: 'ACTIVE', isDeleted: false },
  })
})

test('cancelled activities retain the historical cancelled registration audience for cancellation notices', async () => {
  let registrationWhere: unknown = null
  const db = {
    activity: { findUnique: async () => ({ id: 'activity-1', title: '活动 A', status: 'CANCELLED' }) },
    activityRegistration: { findMany: async (args: { where: unknown }) => { registrationWhere = args.where; return [{ userId: 'user-1', id: 'r1' }] } },
  }
  const audience = await getActivityNotificationAudience(db as never, 'activity-1')
  assert.equal(audience?.userIds.length, 1)
  assert.deepEqual(registrationWhere, {
    activityId: 'activity-1',
    status: { in: ['ACTIVE', 'CANCELLED'] },
    User: { status: 'ACTIVE', isDeleted: false },
  })
})

test('notification input enforces required copy, server-side idempotency, and uploaded image URLs', () => {
  assert.equal(activityNotificationLink('activity-1234'), '/activities/activity-1234')
  assert.deepEqual(normalizeActivityNotificationInput({ title: ' 标题 ', content: ' 正文 ', idempotencyKey: 'activity-key-123456' }), {
    title: '标题', content: '正文', imageUrl: null, idempotencyKey: 'activity-key-123456',
  })
  assert.throws(() => normalizeActivityNotificationInput({ title: '', content: '正文', idempotencyKey: 'activity-key-123456' }), /通知标题不能为空/)
  assert.throws(() => normalizeActivityNotificationInput({ title: '标题', content: '正文', imageUrl: 'https://example.com/image.jpg', idempotencyKey: 'activity-key-123456' }), /站内上传结果/)
})

test('activity notification API and UI keep the audience server-owned and require confirmation', () => {
  const route = read('app/api/admin/activities/[activityId]/notifications/route.ts')
  const service = read('lib/activity-notification.ts')
  const panel = read('app/admin/activities/ActivityTargetedNotificationPanel.tsx')
  const manager = read('app/admin/activities/ActivityAdminManager.tsx')
  assert.match(route, /requireAdmin\('activity_manage'\)/)
  assert.match(route, /getActivityNotificationOverview/)
  assert.match(route, /sendActivityTargetedNotification/)
  assert.match(route, /recipientIds[\s\S]*服务端根据活动报名记录确定/)
  assert.match(service, /activityRegistration\.findMany/)
  assert.match(service, /new Set\(registrations\.map\(\(registration\) => registration\.userId\)\)/)
  assert.match(service, /createManyNotificationsWithDb/)
  assert.match(service, /key: notificationKey/)
  assert.match(service, /activityNotificationLink\(activityId\)/)
  assert.match(panel, /ConfirmDialog/)
  assert.match(panel, /预计接收人数/)
  assert.match(panel, /imageUrl, idempotencyKey/)
  assert.match(manager, /ActivityTargetedNotificationPanel/)
  assert.match(manager, />发送通知</)
})

test('schema and migration persist notification image/activity data without destructive changes', () => {
  const schema = read('prisma/schema.prisma')
  const mysqlTestSchema = read('prisma/schema.mysql-test.prisma')
  const migration = read('prisma/migrations/20260910090000_add_activity_targeted_notifications/migration.sql')
  const baseline = read('prisma/mysql-baseline/current/baseline.sql')
  for (const source of [schema, mysqlTestSchema]) {
    assert.match(source, /model ActivityNotificationBatch \{/)
    assert.match(source, /idempotencyKey\s+String\s+@unique/)
    assert.match(source, /content\s+String\s+@db\.Text/)
  }
  assert.match(schema, /model Notification \{[\s\S]*?content\s+String\?\s+@db\.Text[\s\S]*?imageUrl\s+String\?\s+@db\.Text[\s\S]*?activityId\s+String\?/)
  assert.match(migration, /MODIFY `content` TEXT NULL/)
  assert.match(migration, /ADD COLUMN `imageUrl` TEXT NULL/)
  assert.match(migration, /ADD COLUMN `activityId` VARCHAR\(191\) NULL/)
  assert.doesNotMatch(migration, /DROP COLUMN|TRUNCATE|DELETE FROM|DROP TABLE/i)
  assert.match(baseline, /CREATE TABLE `ActivityNotificationBatch` \(/)
  assert.match(baseline, /`content` TEXT NULL/)
  assert.match(baseline, /`imageUrl` TEXT NULL/)
})
