import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { NotificationType, type Prisma } from '@prisma/client'
import {
  createNotificationWithDb,
  InvalidNotificationTypeError,
  NOTIFICATION_TYPE_VALUES,
} from '../lib/notification-write'

const read = (path: string) => readFileSync(path, 'utf8')

function notificationArgs(type: string): Prisma.NotificationCreateArgs {
  return {
    data: {
      recipientId: 'recipient-test',
      actorId: 'actor-test',
      type: type as Prisma.NotificationCreateArgs['data'] extends { type: infer T } ? T : never,
      title: '通知测试',
      content: '通知内容',
      link: null,
      key: null,
    },
  } as Prisma.NotificationCreateArgs
}

test('听听对决邀请使用 ACTIVITY，而不是非法 Notification 枚举值', () => {
  const service = read('lib/guess-song-duel-service.ts')
  assert.match(service, /createNotification\([\s\S]*type: 'ACTIVITY'/)
  assert.doesNotMatch(service, /GUESS_SONG_DUEL_INVITE/)
})

test('活动通知可以经过公共封装写入', async () => {
  const acceptedTypes: NotificationType[] = [NotificationType.ACTIVITY, NotificationType.REVIEW, NotificationType.FEEDBACK]
  let writes = 0
  const db = {
    notification: {
      create: async (args: Prisma.NotificationCreateArgs) => {
        writes += 1
        assert.ok(acceptedTypes.includes(args.data.type))
        return args
      },
    },
  } as unknown as Prisma.TransactionClient

  for (const type of [NotificationType.ACTIVITY, NotificationType.REVIEW, NotificationType.FEEDBACK]) {
    await createNotificationWithDb(db, notificationArgs(type), { operation: 'notification-type-test' })
  }
  assert.equal(writes, 3)
})

test('空字符串和未知通知类型不会触发数据库写入，并记录明确错误', () => {
  let writes = 0
  const db = {
    notification: {
      create: async () => {
        writes += 1
      },
    },
  } as unknown as Prisma.TransactionClient

  for (const type of ['', 'GUESS_SONG_DUEL_INVITE', 'review']) {
    assert.throws(
      () => createNotificationWithDb(db, notificationArgs(type), { operation: 'invalid-test', userId: 'user-test' }),
      (error: unknown) => error instanceof InvalidNotificationTypeError && error.code === 'INVALID_NOTIFICATION_TYPE',
    )
  }
  assert.equal(writes, 0)
  assert.deepEqual(NOTIFICATION_TYPE_VALUES, Object.values(NotificationType))
  assert.match(read('lib/notification-write.ts'), /logNotificationError\('write\.invalid-type'/)
  assert.doesNotMatch(read('lib/notification-write.ts'), /activityFallback|fallbackType/)
})

test('审核和反馈入口使用合法的 NotificationType 值', () => {
  const posts = read('app/api/posts/route.ts')
  const feedback = read('app/api/feedback/route.ts')
  const writer = read('lib/notification-write.ts')
  assert.match(posts, /type: 'REVIEW' as const/)
  assert.match(feedback, /type: 'FEEDBACK' as const/)
  assert.match(writer, /NotificationType\.REVIEW/)
  assert.match(writer, /NotificationType\.FEEDBACK/)
})
