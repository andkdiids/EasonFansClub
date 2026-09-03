import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getNotificationCategory, getNotificationCategoryFilter } from '../lib/notifications'
import {
  buildCreatorReviewNotificationContent,
  createCreatorReviewNotifications,
  creatorReviewNotificationKey,
  creatorReviewNotificationLink,
} from '../lib/studio/review-notifications'
import type { PrismaClient } from '@prisma/client'

const read = (path: string) => readFileSync(path, 'utf8')

const publishRoute = read('app/api/studio/projects/[projectId]/publish/route.ts')
const saveRoute = read('app/api/studio/projects/route.ts')
const adminPage = read('app/admin/studio/page.tsx')
const adminPanel = read('app/admin/studio/StudioAdminPanel.tsx')
const notifications = read('lib/notifications.ts')
const schema = read('prisma/schema.prisma')

type CreateManyArgs = { data: Array<Record<string, unknown>>; skipDuplicates?: boolean }

function makeNotificationDb(options: { admins?: Array<{ id: string }>; createMany?: (args: CreateManyArgs) => Promise<{ count: number }> } = {}) {
  let userFindManyArgs: unknown
  let notificationCreateManyArgs: CreateManyArgs | null = null
  const db = {
    user: {
      findMany: async (args: unknown) => {
        userFindManyArgs = args
        return options.admins || [{ id: 'admin-a' }, { id: 'admin-b' }]
      },
    },
    notification: {
      createMany: async (args: CreateManyArgs) => {
        notificationCreateManyArgs = args
        return options.createMany ? options.createMany(args) : { count: args.data.length }
      },
    },
  } as unknown as PrismaClient
  return {
    db,
    getUserFindManyArgs: () => userFindManyArgs,
    getNotificationCreateManyArgs: () => notificationCreateManyArgs,
  }
}

const submissionInput = {
  projectId: 'project-1',
  authorId: 'user-1',
  nickname: '贝多芬迷',
  title: '我的第一张图纸',
  reviewVersion: '2026-09-03T00:00:00.000Z',
}

test('投稿进入 PENDING 后向所有有创作平台权限的管理员写 REVIEW 通知，普通用户被排除', async () => {
  const fixture = makeNotificationDb()
  const recipients = await createCreatorReviewNotifications(submissionInput, fixture.db)
  const query = JSON.stringify(fixture.getUserFindManyArgs())
  const write = fixture.getNotificationCreateManyArgs()

  assert.deepEqual(recipients, ['admin-a', 'admin-b'])
  assert.match(query, /"role":\{"in":\["ADMIN","SUPER_ADMIN"\]\}/)
  assert.match(query, /"status":"ACTIVE"/)
  assert.match(query, /"isDeleted":false/)
  assert.match(query, /"permissionKey":"studio_manage"/)
  assert.doesNotMatch(query, /"USER"/)
  assert.ok(write)
  assert.equal(write.skipDuplicates, true)
  assert.deepEqual(write.data.map((item) => item.recipientId), ['admin-a', 'admin-b'])
  assert.ok(write.data.every((item) => item.type === 'REVIEW'))
  assert.ok(write.data.every((item) => item.actorId === 'user-1'))
  assert.ok(write.data.every((item) => item.title === '创作平台有新的待审核投稿'))
  assert.ok(write.data.every((item) => item.content === '贝多芬迷 提交了「我的第一张图纸」，等待审核。'))
  assert.ok(write.data.every((item) => item.link === '/admin/studio?projectId=project-1'))
})

test('管理员审核通知进入现有 review 分类和未读统计，普通账号不能查询该分类', () => {
  const link = creatorReviewNotificationLink('project-1')
  assert.equal(buildCreatorReviewNotificationContent({ nickname: '贝多芬迷', title: '我的第一张图纸' }), '贝多芬迷 提交了「我的第一张图纸」，等待审核。')
  assert.equal(creatorReviewNotificationLink('project/with space'), '/admin/studio?projectId=project%2Fwith%20space')
  assert.equal(getNotificationCategory('REVIEW', link, creatorReviewNotificationKey('project-1', submissionInput.reviewVersion)), 'review')
  assert.deepEqual(getNotificationCategoryFilter('review', false), { id: { in: [] } })
  assert.match(JSON.stringify(getNotificationCategoryFilter('review', true)), /"type":"REVIEW"/)
  assert.match(notifications, /case 'review': return canReview/)
  assert.match(notifications, /n\.type = 'REVIEW'/)
})

test('投稿状态写入成功后才创建管理员通知，重复提交按审核轮次幂等', () => {
  const updateIndex = publishRoute.indexOf("data: { visibility: 'PUBLIC', reviewStatus: 'PENDING' }")
  const notificationIndex = publishRoute.indexOf('const adminRecipientIds = await createCreatorReviewNotifications')
  assert.ok(updateIndex >= 0)
  assert.ok(notificationIndex > updateIndex)
  assert.match(publishRoute, /prisma\.\$transaction/)
  assert.match(publishRoute, /reviewStatus: \{ not: 'PENDING' \}/)
  assert.match(publishRoute, /if \(project\.reviewStatus === 'PENDING'\)/)
  assert.match(publishRoute, /reviewVersion: submitted\.updatedAt\.toISOString\(\)/)
  assert.equal(creatorReviewNotificationKey('project-1', 'round-1'), creatorReviewNotificationKey('project-1', 'round-1'))
  assert.notEqual(creatorReviewNotificationKey('project-1', 'round-1'), creatorReviewNotificationKey('project-1', 'round-2'))
  assert.match(schema, /@@unique\(\[recipientId, key\]\)/)
})

test('驳回后重提产生新审核轮次，草稿保存不触发，通知失败会向上抛出', async () => {
  const fixture = makeNotificationDb({ admins: [{ id: 'admin-a' }] })
  const first = await createCreatorReviewNotifications({ ...submissionInput, reviewVersion: 'round-1' }, fixture.db)
  const second = await createCreatorReviewNotifications({ ...submissionInput, reviewVersion: 'round-2' }, fixture.db)
  assert.deepEqual(first, ['admin-a'])
  assert.deepEqual(second, ['admin-a'])
  assert.notEqual(creatorReviewNotificationKey('project-1', 'round-1'), creatorReviewNotificationKey('project-1', 'round-2'))
  assert.doesNotMatch(saveRoute, /createCreatorReviewNotifications/)
  assert.match(publishRoute, /CREATOR_REVIEW_NOTIFICATION_FAILED/)
  assert.match(publishRoute, /提交公开审核失败，请稍后重试/)

  const failing = makeNotificationDb({ createMany: async () => { throw new Error('notification write failed') } })
  await assert.rejects(
    () => createCreatorReviewNotifications(submissionInput, failing.db),
    /notification write failed/,
  )
})

test('通知 targetUrl 进入审核页并定位对应投稿，实时刷新失败不影响已持久化通知', () => {
  assert.match(publishRoute, /emitRealtimeMany\(result\.adminRecipientIds, 'notification'\)/)
  assert.match(publishRoute, /CREATOR_REVIEW_NOTIFICATION_REALTIME_FAILED/)
  assert.match(adminPage, /searchParams/)
  assert.match(adminPage, /initialProjectId/)
  assert.match(adminPanel, /initialProjectId/)
  assert.match(adminPanel, /setSelectedProject\(project\)/)
  assert.match(adminPanel, /studio-review-project-\$\{project\.id\}/)
  assert.match(adminPanel, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/)
})
