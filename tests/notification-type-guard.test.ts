import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import {
  createNotificationWithDb,
  InvalidNotificationTypeError,
  normalizeNotificationType,
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
  let writes = 0
  const db = {
    notification: {
      create: async (args: Prisma.NotificationCreateArgs) => {
        writes += 1
        assert.equal(args.data.type, 'ACTIVITY')
        return args
      },
    },
  } as unknown as Prisma.TransactionClient

  await createNotificationWithDb(db, notificationArgs('ACTIVITY'), { operation: 'activity-test', activityFallback: true })
  assert.equal(writes, 1)
})

test('非法通知类型不会触发数据库写入，并记录结构化错误', () => {
  let writes = 0
  const db = {
    notification: {
      create: async () => {
        writes += 1
      },
    },
  } as unknown as Prisma.TransactionClient

  assert.throws(
    () => createNotificationWithDb(db, notificationArgs('GUESS_SONG_DUEL_INVITE'), { operation: 'invalid-test', userId: 'user-test' }),
    (error: unknown) => error instanceof InvalidNotificationTypeError && error.code === 'INVALID_NOTIFICATION_TYPE',
  )
  assert.equal(writes, 0)
  assert.equal(normalizeNotificationType('GUESS_SONG_DUEL_INVITE', { operation: 'activity-fallback-test', activityFallback: true }), 'ACTIVITY')
  assert.deepEqual(NOTIFICATION_TYPE_VALUES, [
    'REPLY',
    'LIKE',
    'SYSTEM',
    'MESSAGE',
    'ACTIVITY',
    'ADMIN',
    'FOLLOW',
    'BADGE',
    'FRIEND_REQUEST',
    'BIRTHDAY_GREETING',
  ])
})
