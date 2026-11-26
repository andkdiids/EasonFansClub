import assert from 'node:assert/strict'
import Module from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'

// Exercise the push queue and guarded dispatcher with an in-memory fixture.
// No production database, Expo network call, or server credential is used.
type Delivery = {
  id: string
  dedupeKey: string
  userId: string
  title: string
  body: string
  payload: unknown
  status: string
  attempts: number
  nextAttemptAt: Date
  tokenCount: number
  lastError: string | null
}
type PushToken = { id: string; userId: string; expoPushToken: string; status: string; failureCount: number; lastFailureReason: string | null }

const deliveries: Delivery[] = []
const tokens: PushToken[] = []
const logErrors: unknown[] = []
let nextId = 0

function deliveryDb() {
  return {
    mobilePushDelivery: {
      create: async ({ data }: { data: Omit<Delivery, 'id' | 'status' | 'attempts' | 'nextAttemptAt' | 'tokenCount' | 'lastError'> }) => {
        if (deliveries.some((row) => row.dedupeKey === data.dedupeKey)) {
          const { Prisma } = await import('@prisma/client')
          throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.19.3' })
        }
        const row: Delivery = {
          ...data,
          id: `delivery-${++nextId}`,
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: new Date('2026-11-26T00:00:00.000Z'),
          tokenCount: 0,
          lastError: null,
        }
        deliveries.push(row)
        return row
      },
    },
  }
}

function sweepDb() {
  return {
    mobilePushDelivery: {
      findMany: async ({ where }: { where: { status: string; nextAttemptAt: { lte: Date } } }) =>
        deliveries.filter((row) => row.status === where.status && row.nextAttemptAt <= where.nextAttemptAt.lte),
      update: async ({ where, data }: { where: { id: string }; data: Partial<Delivery> }) => {
        const row = deliveries.find((item) => item.id === where.id)
        if (row) Object.assign(row, data)
        return row
      },
    },
    mobilePushToken: {
      findMany: async ({ where }: { where: { userId: string; status: string } }) =>
        tokens.filter((token) => token.userId === where.userId && token.status === where.status),
      update: async ({ where, data }: { where: { id: string }; data: Partial<PushToken> }) => {
        const row = tokens.find((token) => token.id === where.id)
        if (row) Object.assign(row, data)
        return row
      },
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: Partial<PushToken> }) => {
        for (const row of tokens) if (where.id.in.includes(row.id)) Object.assign(row, data)
        return { count: where.id.in.length }
      },
    },
  }
}

const sweepPrisma = sweepDb()

const originalLoad = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
;(Module as unknown as { _load: typeof originalLoad })._load = function (request, parent, isMain) {
  if (request === '@/lib/prisma') return { prisma: sweepPrisma }
  if (request === '@/lib/notification-errors') {
    return { logNotificationError: (_stage: string, _context: unknown, error: Error) => logErrors.push(error.message) }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('only selected in-app notification types are pushed; generic system notices are not', async () => {
  const { shouldPushNotification } = await import('../lib/mobile-push')
  assert.equal(shouldPushNotification({ type: 'FRIEND_REQUEST' }), true)
  assert.equal(shouldPushNotification({ type: 'BADGE' }), true)
  assert.equal(shouldPushNotification({ type: 'SYSTEM', key: 'shun:round-1:taken' }), true)
  assert.equal(shouldPushNotification({ type: 'SYSTEM', key: 'maintenance-notice' }), false)
  assert.equal(shouldPushNotification({ type: 'REPLY' }), false)
  assert.equal(shouldPushNotification({ type: 'FOLLOW' }), false)
})

test('notification and DM queues dedupe on stable keys and never expose message bodies', async () => {
  deliveries.length = 0
  const { queueMobilePushForNotificationData, queueDirectMessagePush } = await import('../lib/mobile-push')
  const db = deliveryDb() as never
  await queueMobilePushForNotificationData(db, {
    type: 'SYSTEM', recipientId: 'user-a', title: '顺大师 · 匿名信', content: '真实来信正文不得出现在通知栏',
    key: 'shun:round-1:taken-letter', link: '/shun-master?record=round-1&letter=1',
  })
  await queueMobilePushForNotificationData(db, {
    type: 'SYSTEM', recipientId: 'user-a', title: '顺大师 · 匿名信', content: '真实来信正文不得出现在通知栏',
    key: 'shun:round-1:taken-letter', link: '/shun-master?record=round-1&letter=1',
  })
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].body, '顺大师 · 匿名信')
  assert.ok(!JSON.stringify(deliveries[0].payload).includes('真实来信正文'))

  await queueDirectMessagePush(db, { userId: 'user-a', messageId: 'msg-1', conversationId: 'conv-1' })
  await queueDirectMessagePush(db, { userId: 'user-a', messageId: 'msg-1', conversationId: 'conv-1' })
  assert.equal(deliveries.length, 2)
  assert.equal(deliveries[1].title, '你收到一条新私信')
  assert.ok(!JSON.stringify(deliveries[1].payload).includes('私信正文'))
})

test('Expo messages map to business channels and carry only routing markers', async () => {
  const { buildExpoPushMessages } = await import('../lib/mobile-push-sender')
  const message = buildExpoPushMessages(
    { title: '你收到一条新私信', body: '打开私家E院查看新私信', payload: { type: 'MESSAGE', link: '/messages/conv-1', notificationId: 'n-1' } },
    ['ExponentPushToken[aaa111bbb222]', 'ExponentPushToken[ccc333ddd444]'],
  )
  assert.equal(message.length, 2)
  assert.equal(message[0].channelId, 'ecfc-messages')
  assert.equal(message[0].sound, 'default')
  assert.deepEqual(message[0].data, { type: 'MESSAGE', link: '/messages/conv-1', notificationId: 'n-1' })
  assert.equal(buildExpoPushMessages({ title: 'x', body: 'y', payload: { type: 'FRIEND_REQUEST' } }, ['t'])[0].channelId, 'ecfc-friends')
  assert.equal(buildExpoPushMessages({ title: 'x', body: 'y', payload: { type: 'BADGE' } }, ['t'])[0].channelId, 'ecfc-games')
  assert.equal(buildExpoPushMessages({ title: 'x', body: 'y', payload: { type: 'SYSTEM' } }, ['t'])[0].channelId, 'ecfc-system')
})

test('missing server credential holds the queue without consuming attempts', async () => {
  deliveries.length = 0
  tokens.length = 0
  deliveries.push({ id: 'd-hold', dedupeKey: 'dm:hold', userId: 'user-a', title: 't', body: 'b', payload: {}, status: 'PENDING', attempts: 0, nextAttemptAt: new Date('2026-11-26T00:00:00.000Z'), tokenCount: 0, lastError: null })
  const previous = process.env.EXPO_ACCESS_TOKEN
  delete process.env.EXPO_ACCESS_TOKEN
  const { runMobilePushSweepOnce } = await import('../lib/mobile-push-sender')
  let called = false
  const result = await runMobilePushSweepOnce(new Date('2026-11-26T01:00:00.000Z'), async () => { called = true; return {} })
  process.env.EXPO_ACCESS_TOKEN = previous
  assert.equal(result.credentialsMissing, true)
  assert.equal(result.scanned, 1)
  assert.equal(called, false)
  assert.equal(deliveries[0].attempts, 0)
  assert.equal(deliveries[0].status, 'PENDING')
})

test('worker marks successful sends, disables stale tokens, and retries total failures with backoff', async () => {
  deliveries.length = 0
  tokens.length = 0
  const now = new Date('2026-11-26T01:00:00.000Z')
  deliveries.push(
    { id: 'd-ok', dedupeKey: 'dm:ok', userId: 'user-a', title: 't', body: 'b', payload: { type: 'MESSAGE' }, status: 'PENDING', attempts: 0, nextAttemptAt: new Date('2026-11-26T00:00:00.000Z'), tokenCount: 0, lastError: null },
    { id: 'd-fail', dedupeKey: 'dm:fail', userId: 'user-b', title: 't', body: 'b', payload: {}, status: 'PENDING', attempts: 0, nextAttemptAt: new Date('2026-11-26T00:00:00.000Z'), tokenCount: 0, lastError: null },
    { id: 'd-notoken', dedupeKey: 'dm:none', userId: 'user-c', title: 't', body: 'b', payload: {}, status: 'PENDING', attempts: 0, nextAttemptAt: new Date('2026-11-26T00:00:00.000Z'), tokenCount: 0, lastError: null },
  )
  tokens.push(
    { id: 'tok-ok', userId: 'user-a', expoPushToken: 'ExponentPushToken[aaa111bbb222]', status: 'ACTIVE', failureCount: 0, lastFailureReason: null },
    { id: 'tok-stale', userId: 'user-b', expoPushToken: 'ExponentPushToken[ccc333ddd444]', status: 'ACTIVE', failureCount: 0, lastFailureReason: null },
  )
  const previous = process.env.EXPO_ACCESS_TOKEN
  process.env.EXPO_ACCESS_TOKEN = 'server-side-test-token'
  const { runMobilePushSweepOnce } = await import('../lib/mobile-push-sender')
  const calls: Array<{ endpoint: string; body: unknown }> = []
  const result = await runMobilePushSweepOnce(now, async (endpoint, body) => {
    calls.push({ endpoint, body })
    if (endpoint.includes('getReceipts')) return { data: {} }
    const first = body as { messages: Array<{ to: string }> }
    if (first.messages[0].to.includes('aaa111')) return { data: [{ status: 'ok', id: 'receipt-1' }] }
    return { data: [{ status: 'error', message: 'DeviceNotRegistered', details: { error: 'DeviceNotRegistered' } }] }
  })
  process.env.EXPO_ACCESS_TOKEN = previous

  assert.equal(result.scanned, 3)
  assert.equal(result.sent, 1)
  assert.equal(result.skipped, 1)
  assert.equal(deliveries.find((row) => row.id === 'd-ok')?.status, 'SENT')
  assert.equal(deliveries.find((row) => row.id === 'd-fail')?.status, 'PENDING')
  assert.equal(deliveries.find((row) => row.id === 'd-fail')?.attempts, 1)
  assert.ok((deliveries.find((row) => row.id === 'd-fail')?.nextAttemptAt.getTime() || 0) > now.getTime())
  assert.equal(tokens.find((token) => token.id === 'tok-stale')?.status, 'DISABLED')
  assert.equal(calls.length >= 2, true)
})

test('token routes bind to Bearer user only, and push credentials stay server-side', () => {
  const register = source('app/api/mobile/push/tokens/route.ts')
  const unregister = source('app/api/mobile/push/tokens/unregister/route.ts')
  for (const route of [register, unregister]) {
    assert.match(route, /resolveMobileAccess\(request\)/)
    assert.match(route, /consumeApiRateLimits/)
    assert.match(route, /Cache-Control.*no-store/)
  }
  assert.match(register, /where: \{ expoPushToken \}/)
  assert.match(register, /EXPO_PUSH_TOKEN_PATTERN/)
  assert.match(unregister, /token\.userId === auth\.user\.id/)
  const sender = source('lib/mobile-push-sender.ts')
  assert.match(sender, /process\.env\.EXPO_ACCESS_TOKEN/)
  assert.doesNotMatch(sender, /EXPO_ACCESS_TOKEN.*expoConfig/)
  assert.doesNotMatch(register, /EXPO_ACCESS_TOKEN/)
  assert.doesNotMatch(unregister, /EXPO_ACCESS_TOKEN/)
  const schema = source('prisma/schema.prisma')
  assert.match(schema, /model MobilePushToken/)
  assert.match(schema, /model MobilePushDelivery/)
  assert.match(schema, /dedupeKey\s+String\s+@unique/)
  assert.equal(existsSync(new URL('../prisma/migrations/20261126040000_add_mobile_push_tokens/migration.sql', import.meta.url)), true)
  assert.match(source('server.ts'), /startMobilePushWorker/)
  assert.match(source('lib/notification-write.ts'), /queueMobilePushForNotificationData/)
  assert.match(source('app/api/direct-conversations/[conversationId]/messages/route.ts'), /queueDirectMessagePush/)
})
