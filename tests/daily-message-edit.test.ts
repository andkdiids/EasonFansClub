import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { DailyMessageEditError, editDailyMessageForOwner } from '@/lib/daily-message-edit'

const read = (path: string) => readFileSync(path, 'utf8')

const schema = read('prisma/schema.prisma')
const testSchema = read('prisma/schema.mysql-test.prisma')
const migration = read('prisma/migrations/20260914110000_add_daily_message_edit/migration.sql')
const supplement = read('lib/checkin-message-supplement.ts')
const editRoute = read('app/api/daily-messages/[messageId]/route.ts')
const profileModules = read('components/PublicUserModules.tsx')

const now = new Date('2026-09-14T12:00:00.000Z')
const createdAt = new Date('2026-09-14T01:00:00.000Z')

function createFakeDatabase(initialEditedAt: Date | null = null, initialUserId = 'user-1') {
  let row = {
    id: 'message-1',
    userId: initialUserId,
    date: new Date('2026-09-14T00:00:00.000+08:00'),
    content: '原留言',
    isDeleted: false,
    checkInId: 'checkin-1',
    editedAt: initialEditedAt,
    createdAt,
    CheckIn: { userId: initialUserId, checkinDateKey: '2026-09-14', type: 'NORMAL', isMakeUp: false },
  }
  const projections = { checkIn: '', friendActivity: '' }
  const database = {
    dailyMessage: {
      findUnique: async () => row,
      updateMany: async (args: unknown) => {
        const data = (args as { data: { content: string; editedAt: Date } }).data
        if (row.isDeleted || row.editedAt) return { count: 0 }
        row = { ...row, content: data.content, editedAt: data.editedAt }
        return { count: 1 }
      },
    },
    checkIn: {
      updateMany: async (args: unknown) => {
        projections.checkIn = (args as { data: { message: string } }).data.message
        return { count: 1 }
      },
    },
    friendActivity: {
      updateMany: async (args: unknown) => {
        projections.friendActivity = (args as { data: { content: string } }).data.content
        return { count: 1 }
      },
    },
  } as unknown as Parameters<typeof editDailyMessageForOwner>[0]
  return { database, getRow: () => row, projections }
}

test('schema adds one nullable edit timestamp without changing DailyMessage identity', () => {
  assert.match(schema, /model DailyMessage \{[\s\S]*?editedAt\s+DateTime\?/)
  assert.match(testSchema, /model DailyMessage \{[\s\S]*?editedAt\s+DateTime\?/)
  assert.match(migration, /ALTER TABLE `DailyMessage`[\s\S]*ADD COLUMN `editedAt` DATETIME\(3\) NULL;/)
  assert.doesNotMatch(migration, /DROP|TRUNCATE|DELETE FROM|CREATE TABLE/)
})

test('create gate still sees the soft-deleted DailyMessage relation', () => {
  assert.match(supplement, /if \(existing\.DailyMessage\)/)
  assert.match(supplement, /MESSAGE_ALREADY_SUPPLEMENTED/)
})

test('edit updates the existing message and its denormalized projections', async () => {
  const fake = createFakeDatabase()
  const result = await editDailyMessageForOwner(fake.database, {
    messageId: 'message-1',
    userId: 'user-1',
    content: '  修改后的留言  ',
    now,
  })

  assert.equal(result.id, 'message-1')
  assert.equal(result.content, '修改后的留言')
  assert.equal(result.createdAt, createdAt)
  assert.equal(result.editedAt, now)
  assert.equal(fake.getRow().content, '修改后的留言')
  assert.equal(fake.projections.checkIn, '修改后的留言')
  assert.equal(fake.projections.friendActivity, '修改后的留言')
})

test('editedAt null is an atomic one-time gate for concurrent edits', async () => {
  const fake = createFakeDatabase()
  const results = await Promise.allSettled([
    editDailyMessageForOwner(fake.database, { messageId: 'message-1', userId: 'user-1', content: '手机修改', now }),
    editDailyMessageForOwner(fake.database, { messageId: 'message-1', userId: 'user-1', content: '电脑修改', now: new Date(now.getTime() + 1000) }),
  ])

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  assert.ok(rejected)
  assert.ok(rejected.reason instanceof DailyMessageEditError)
  assert.equal(rejected.reason.code, 'EDIT_ALREADY_USED')
})

test('owner, current-day check-in, and content validation are enforced before editing', async () => {
  const notOwner = createFakeDatabase(null, 'owner-1')
  await assert.rejects(
    editDailyMessageForOwner(notOwner.database, { messageId: 'message-1', userId: 'other-user', content: '越权', now }),
    (error: unknown) => error instanceof DailyMessageEditError && error.code === 'FORBIDDEN' && error.status === 403,
  )

  const oldMessage = createFakeDatabase()
  oldMessage.getRow().date = new Date('2026-09-13T00:00:00.000+08:00')
  await assert.rejects(
    editDailyMessageForOwner(oldMessage.database, { messageId: 'message-1', userId: 'user-1', content: '历史留言', now }),
    (error: unknown) => error instanceof DailyMessageEditError && error.code === 'MESSAGE_NOT_ELIGIBLE',
  )

  const invalid = createFakeDatabase()
  await assert.rejects(
    editDailyMessageForOwner(invalid.database, { messageId: 'message-1', userId: 'user-1', content: '   ', now }),
    (error: unknown) => error instanceof DailyMessageEditError && error.code === 'INVALID_MESSAGE',
  )
})

test('edit route uses PATCH and never creates another DailyMessage', () => {
  assert.match(editRoute, /export async function PATCH/)
  assert.match(editRoute, /editDailyMessageForOwner\(/)
  assert.doesNotMatch(editRoute, /dailyMessage\.create/)
  assert.match(editRoute, /code: error\.code/)
  assert.match(editRoute, /status: error\.status/)
})

test('profile UI exposes edit only for an eligible unedited own message and confirms once', () => {
  assert.match(profileModules, /message\.canEdit && !message\.editedAt/)
  assert.match(profileModules, /method: 'PATCH'/)
  assert.match(profileModules, /title="确认修改留言？"/)
  assert.match(profileModules, /每条每日挂号留言只有一次编辑机会/)
  assert.match(profileModules, /编辑/)
  assert.match(profileModules, /删除/)
})
