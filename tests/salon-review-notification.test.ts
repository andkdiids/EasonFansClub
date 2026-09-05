import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { getNotificationCategoryFilter } from '@/lib/notifications'
import { getNotificationTarget } from '@/lib/notification-target'
import {
  buildSalonReviewNotificationContent,
  completeSalonReviewNotifications,
  createSalonReviewNotifications,
  salonReviewNotificationKey,
  salonReviewNotificationLink,
} from '@/lib/salon-review-notifications'

const read = (path: string) => readFileSync(path, 'utf8')
const submitRoute = read('app/api/salon/posts/route.ts')
const adminRoute = read('app/api/admin/salon/route.ts')
const adminPage = read('app/admin/salon/page.tsx')
const adminManager = read('app/admin/salon/AdminSalonManager.tsx')
const notificationService = read('lib/notifications.ts')
const notificationSchema = read('prisma/schema.prisma')

function asDb(value: unknown) {
  return value as PrismaClient
}

test('新建 PENDING 沙龙投稿后才写管理员审核通知', () => {
  const createdAt = submitRoute.indexOf('const post = await prisma.salonPost.create')
  const notifiedAt = submitRoute.indexOf('const adminRecipientIds')
  assert.ok(createdAt >= 0)
  assert.ok(notifiedAt > createdAt)
  assert.match(submitRoute, /status: 'PENDING'/)
  assert.match(submitRoute, /operation: 'salon\.admin-review-notification\.failed'/)
  assert.match(submitRoute, /targetId: post\.id/)
  assert.match(submitRoute, /emitRealtimeMany\(adminRecipientIds, 'notification'\)/)
})

test('四种沙龙分类都使用前台中文分类名', () => {
  const expected = new Map([
    ['CONCERT', '演唱会记录'],
    ['MOBILE_WALLPAPER', '手机壁纸'],
    ['DESKTOP_WALLPAPER', '电脑壁纸'],
    ['TIME_TRAVEL', '时光倒流二十年'],
  ])
  for (const [category, label] of expected) {
    const content = buildSalonReviewNotificationContent({ nickname: '测试用户', category, title: '作品标题' })
    assert.equal(content, `测试用户 投稿了「${label}」《作品标题》，请审核`)
  }
  assert.match(read('lib/salon-shared.ts'), /TIME_TRAVEL:\s*\{[\s\S]*label: '时光倒流二十年'/)
})

test('通知 writer 只解析有 post_manage 权限的活跃管理员，并为每人写一条', async () => {
  let query: unknown
  let createArgs: { data: Array<Record<string, unknown>>; skipDuplicates?: boolean } | undefined
  const db = asDb({
    user: {
      findMany: async (args: unknown) => {
        query = args
        return [{ id: 'admin-a' }, { id: 'admin-b' }]
      },
    },
    notification: {
      createMany: async (args: { data: Array<Record<string, unknown>>; skipDuplicates?: boolean }) => {
        createArgs = args
        return { count: args.data.length }
      },
    },
  })

  const ids = await createSalonReviewNotifications({
    postId: 'salon-post-1',
    authorId: 'author-1',
    nickname: '投稿者',
    category: 'CONCERT',
    title: '现场记录',
  }, db)

  assert.deepEqual(ids, ['admin-a', 'admin-b'])
  assert.match(JSON.stringify(query), /"post_manage"/)
  assert.match(JSON.stringify(query), /"ACTIVE"/)
  assert.match(JSON.stringify(query), /"isDeleted":false/)
  assert.deepEqual(createArgs?.data.map((item) => item.recipientId), ['admin-a', 'admin-b'])
  assert.ok(createArgs?.data.every((item) => item.type === 'REVIEW'))
  assert.equal(createArgs?.data[0]?.key, 'salon-review:salon-post-1')
  assert.equal(createArgs?.data[0]?.link, '/admin/salon?postId=salon-post-1')
  assert.equal(createArgs?.skipDuplicates, true)
})

test('普通用户不会看到管理员审核 REVIEW 通知，管理员继续复用现有审核分类', () => {
  assert.deepEqual(getNotificationCategoryFilter('review', false), { id: { in: [] } })
  assert.match(JSON.stringify(getNotificationCategoryFilter('review', true)), /REVIEW/)
  assert.match(notificationService, /case 'review': return canReview/)
  assert.match(notificationService, /n\.type = 'REVIEW'/)
})

test('通知保留具体投稿 target，并能通过现有通知跳转解析器打开后台深链', () => {
  const postId = 'salon/post with spaces'
  const link = salonReviewNotificationLink(postId)
  assert.equal(salonReviewNotificationKey(postId), 'salon-review:salon/post with spaces')
  assert.equal(link, '/admin/salon?postId=salon%2Fpost%20with%20spaces')
  assert.equal(getNotificationTarget({ id: 'notification-1', source: 'personal', type: 'REVIEW', link, targetUrl: null }), link)
  assert.match(adminPage, /searchParams/)
  assert.match(adminManager, /\/api\/admin\/salon\?postId=/)
  assert.match(adminManager, /salon-post-\$\{post\.id\}/)
})

test('通知深链不会用目标投稿替换完整待审核列表，首次进入与 Tab 切换共用分页加载', () => {
  const initialLoad = adminManager.indexOf("void load('PENDING', 1)")
  assert.ok(initialLoad >= 0)
  assert.match(adminManager, /void load\('PENDING', 1\)[\s\S]*\}, \[initialPostId, load\]\)/)
  assert.match(adminManager, /const \[targetStatus, setTargetStatus\]/)
  assert.match(adminManager, /const requestId = listRequestRef\.current \+ 1/)
  assert.match(adminManager, /setTargetStatus\('MISSING'\)/)
  assert.match(adminManager, /当前仍显示完整待审核列表/)

  const targetStart = adminManager.indexOf('fetch(`/api/admin/salon?postId=')
  const targetEnd = adminManager.indexOf('  useEffect(() => {', targetStart + 1)
  assert.ok(targetStart >= 0)
  assert.ok(targetEnd > targetStart)
  const targetLookup = adminManager.slice(targetStart, targetEnd)
  assert.doesNotMatch(targetLookup, /setPosts\(|setPage\(|setHasMore\(|setStatus\(/)
  assert.match(targetLookup, /setTargetStatus\(/)
})

test('同一投稿按 recipientId + business key 去重，客户端重试不生成重复审核事件', () => {
  assert.match(submitRoute, /submissionKey/)
  assert.match(submitRoute, /error\.code === 'P2002'/)
  assert.match(submitRoute, /if \(existing\) return NextResponse\.json\(\{ ok: true, duplicate: true/)
  assert.match(notificationSchema, /@@unique\(\[recipientId, key\]\)/)
  assert.match(read('lib/salon-review-notifications.ts'), /skipDuplicates: true/)
})

test('管理员审核后所有该投稿审核通知变为已处理，且更新会通知原收件人', async () => {
  let updateArgs: { data: Record<string, unknown> } | undefined
  const db = asDb({
    notification: {
      findMany: async () => [{ recipientId: 'admin-a' }, { recipientId: 'admin-b' }, { recipientId: 'admin-a' }],
      updateMany: async (args: { data: Record<string, unknown> }) => {
        updateArgs = args
        return { count: 3 }
      },
    },
  })
  const completedAt = new Date('2026-08-31T10:00:00.000Z')
  const recipients = await completeSalonReviewNotifications({ postId: 'salon-post-2', status: 'APPROVED', title: '作品', completedAt }, db)
  assert.deepEqual(recipients, ['admin-a', 'admin-b'])
  assert.equal(updateArgs?.data.title, '沙龙投稿已通过审核')
  assert.equal(updateArgs?.data.completedAt, completedAt)
  assert.equal(updateArgs?.data.isRead, true)
  assert.equal(updateArgs?.data.readAt, completedAt)

  const rejected = await completeSalonReviewNotifications({ postId: 'salon-post-3', status: 'REJECTED', title: '作品', completedAt }, db)
  assert.deepEqual(rejected, ['admin-a', 'admin-b'])
  assert.equal(updateArgs?.data.title, '沙龙投稿已拒绝')
  assert.match(adminRoute, /current\.status !== 'PENDING'/)
  assert.match(adminManager, /post\.status === 'PENDING'/)
})

test('作者审核结果继续进入普通通知中心，且不会伪装成管理员待审核通知', () => {
  assert.match(adminRoute, /recipientId: current\.userId/)
  assert.match(adminRoute, /type: 'ADMIN'/)
  assert.match(adminRoute, /link: '\/salon\/mine'/)
  assert.match(adminRoute, /emitRealtime\(current\.userId, 'notification'\)/)
  assert.match(read('lib/notifications.ts'), /审核结果通知仍用 `type: 'ADMIN'` 存储/)
})

test('通知写入失败不会回滚已完成的上传，并记录专用失败 operation', () => {
  assert.match(submitRoute, /safeNotificationWrite\(/)
  assert.match(submitRoute, /operation: 'salon\.admin-review-notification\.failed'/)
  assert.match(read('lib/notification-transaction.ts'), /通知写入失败.*成功核心操作|notification writes are secondary/i)
  assert.match(submitRoute, /return NextResponse\.json\(\{ ok: true, postId: post\.id/)
})
