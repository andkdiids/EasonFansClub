import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import {
  BIRTHDAY_ALREADY_SET,
  BIRTHDATE_SELF_EDIT_EXHAUSTED,
  BirthdayAlreadySetError,
  BirthdaySelfEditExhaustedError,
  getBirthdayEditState,
  isBirthdayConfigured,
  updateUserBirthdate,
  type BirthdayRecord,
} from '@/lib/birthday-immutability'
import { isBirthdayToday, isValidBirthdayParts, getZodiacSignFromBirthday } from '@/lib/zodiac'

const read = (path: string) => readFileSync(path, 'utf8')

type FakeRow = Omit<Required<BirthdayRecord>, 'birthdateSelfEditCount'> & { birthdateSelfEditCount: number }

function createFakeBirthdayDb(initial: FakeRow): Prisma.TransactionClient {
  let row: FakeRow | null = { ...initial }

  const user = {
    async findUnique() {
      return row ? { ...row } : null
    },
    async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      if (!row || args.where.id !== 'user-1') return { count: 0 }

      const countCondition = args.where.birthdateSelfEditCount as { lt?: number } | undefined
      if (countCondition?.lt !== undefined && row.birthdateSelfEditCount >= countCondition.lt) return { count: 0 }
      for (const key of ['birthMonth', 'birthDay', 'birthdaySetAt'] as const) {
        if (!(key in args.where)) continue
        const expected = args.where[key]
        const actual = row[key]
        if (expected instanceof Date && actual instanceof Date) {
          if (expected.getTime() !== actual.getTime()) return { count: 0 }
        } else if (actual !== expected) {
          return { count: 0 }
        }
      }

      const increment = args.data.birthdateSelfEditCount as { increment?: number } | undefined
      row = {
        ...row,
        birthMonth: typeof args.data.birthMonth === 'number' ? args.data.birthMonth : row.birthMonth,
        birthDay: typeof args.data.birthDay === 'number' ? args.data.birthDay : row.birthDay,
        birthdaySetAt: args.data.birthdaySetAt instanceof Date ? args.data.birthdaySetAt : row.birthdaySetAt,
        birthdateSelfEditCount: increment?.increment ? row.birthdateSelfEditCount + increment.increment : row.birthdateSelfEditCount,
      }
      return { count: 1 }
    },
    async update(args: { data: Record<string, unknown> }) {
      if (!row) throw new Error('USER_NOT_FOUND')
      row = {
        ...row,
        birthMonth: typeof args.data.birthMonth === 'number' ? args.data.birthMonth : row.birthMonth,
        birthDay: typeof args.data.birthDay === 'number' ? args.data.birthDay : row.birthDay,
        birthdaySetAt: args.data.birthdaySetAt instanceof Date ? args.data.birthdaySetAt : row.birthdaySetAt,
      }
      return { ...row }
    },
  }

  return { user } as unknown as Prisma.TransactionClient
}

function blankBirthday(): FakeRow {
  return { birthMonth: null, birthDay: null, birthdaySetAt: null, birthdateSelfEditCount: 0 }
}

function setBirthday(month: number, day: number, count = 0): FakeRow {
  return {
    birthMonth: month,
    birthDay: day,
    birthdaySetAt: new Date('2026-09-03T00:00:00.000Z'),
    birthdateSelfEditCount: count,
  }
}

test('CASE 1: a new user can set a valid birthday and keeps one self-edit', async () => {
  const db = createFakeBirthdayDb(blankBirthday())
  const result = await updateUserBirthdate(db, {
    targetUserId: 'user-1',
    birthdate: { month: 5, day: 21 },
    actor: 'SELF',
    now: new Date('2026-09-07T00:00:00.000Z'),
  })

  assert.deepEqual(result, {
    status: 'set',
    changed: true,
    previousBirthday: null,
    birthday: { month: 5, day: 21 },
    birthdaySetAt: new Date('2026-09-07T00:00:00.000Z'),
    birthdateSelfEditCount: 0,
  })
  assert.equal(getBirthdayEditState(await db.user.findUnique({ where: { id: 'user-1' } })).canEditBirthdate, true)
})

test('CASE 2: submitting the same birthday is an allowed no-op', async () => {
  const existing = setBirthday(5, 21)
  const db = createFakeBirthdayDb(existing)
  const result = await updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 5, day: 21 }, actor: 'SELF' })

  assert.equal(result.status, 'noop')
  assert.equal(result.changed, false)
  assert.equal(result.birthdateSelfEditCount, 0)
  assert.deepEqual(await db.user.findUnique({ where: { id: 'user-1' } }), existing)
})

test('CASE 3/4: a configured user may change once, then receives the exhausted error', async () => {
  const db = createFakeBirthdayDb(setBirthday(5, 21))
  const result = await updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 5, day: 22 }, actor: 'SELF' })
  assert.equal(result.status, 'updated')
  assert.equal(result.birthdateSelfEditCount, 1)

  await assert.rejects(
    updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 6, day: 21 }, actor: 'SELF' }),
    (error: unknown) => error instanceof BirthdaySelfEditExhaustedError && error.code === BIRTHDATE_SELF_EDIT_EXHAUSTED,
  )
})

test('CASE 5: clearing an existing birthday is rejected', async () => {
  const db = createFakeBirthdayDb(setBirthday(5, 21))
  await assert.rejects(
    updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: null, actor: 'SELF' }),
    (error: unknown) => error instanceof BirthdayAlreadySetError && error.code === BIRTHDAY_ALREADY_SET,
  )
  assert.deepEqual(await db.user.findUnique({ where: { id: 'user-1' } }), setBirthday(5, 21))
})

test('CASE 6/7: concurrent self edits consume at most one edit slot', async () => {
  const db = createFakeBirthdayDb(setBirthday(5, 21))
  const results = await Promise.allSettled([
    updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 7, day: 15 }, actor: 'SELF' }),
    updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 6, day: 21 }, actor: 'SELF' }),
  ])

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  assert.equal((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.code, BIRTHDATE_SELF_EDIT_EXHAUSTED)
  assert.equal((await db.user.findUnique({ where: { id: 'user-1' } }))?.birthdateSelfEditCount, 1)
})

test('CASE 8: historical birthday rows default to count zero and retain one edit', async () => {
  assert.equal(isBirthdayConfigured({ birthMonth: 5, birthDay: 21, birthdaySetAt: null }), true)
  const db = createFakeBirthdayDb(setBirthday(5, 21))
  const result = await updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 7, day: 15 }, actor: 'SELF' })
  assert.equal(result.status, 'updated')
  assert.equal(result.birthdateSelfEditCount, 1)
})

test('CASE 9: admin changes do not consume or reset the self-edit count', async () => {
  const db = createFakeBirthdayDb(setBirthday(7, 15, 1))
  const result = await updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 8, day: 20 }, actor: 'ADMIN' })
  assert.equal(result.changed, true)
  assert.equal(result.birthdateSelfEditCount, 1)
  await assert.rejects(
    updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 9, day: 7 }, actor: 'SELF' }),
    BirthdaySelfEditExhaustedError,
  )
})

test('CASE 10: birthday validation accepts February 29 and rejects February 30', async () => {
  assert.equal(isValidBirthdayParts({ month: 2, day: 29 }), true)
  assert.equal(isValidBirthdayParts({ month: 2, day: 30 }), false)
  const db = createFakeBirthdayDb(blankBirthday())
  await assert.rejects(updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 2, day: 30 }, actor: 'SELF' }), /INVALID_BIRTHDAY/)
})

test('CASE 11: the API and UI use the shared mutation service and keep birthday writes separate', () => {
  const route = read('app/api/users/me/route.ts')
  const helper = read('lib/birthday-immutability.ts')
  const form = read('app/profile/ProfileSettingsForm.tsx')
  const dataBlock = route.slice(route.indexOf('const data:'), route.indexOf('if (body?.bio !== undefined)'))

  assert.match(route, /updateUserBirthdate\(tx, \{[\s\S]*actor: 'SELF'/)
  assert.match(helper, /updateMany\(/)
  assert.match(helper, /birthdateSelfEditCount:\s*\{ lt: BIRTHDATE_SELF_EDIT_LIMIT \}/)
  assert.match(helper, /birthMonth:\s*null/)
  assert.match(helper, /birthDay:\s*null/)
  assert.match(helper, /birthdaySetAt:\s*null/)
  assert.match(route, /birthdayPublic !== undefined\) data\.birthdayPublic = birthdayPublic/)
  assert.doesNotMatch(dataBlock, /birthMonth|birthDay|birthdaySetAt/)
  assert.match(form, /persistedBirthday\.canEditBirthdate/)
  assert.match(form, /const birthdayPayload = birthdayToSave/)
  assert.match(form, /birthdayPublic: Boolean\(form\.birthdayPublic\)/)
})

test('CASE 12: profile state exposes one remaining edit and then a read-only state', () => {
  assert.deepEqual(getBirthdayEditState(setBirthday(5, 21)), {
    hasBirthdate: true,
    birthdateSelfEditCount: 0,
    birthdateEditUsed: false,
    canEditBirthdate: true,
    birthdayEditRemaining: 1,
  })
  assert.equal(getBirthdayEditState(setBirthday(5, 21, 1)).canEditBirthdate, false)
  assert.match(read('app/profile/ProfileSettingsForm.tsx'), /生日已修改过一次，无法再次自行修改生日。/)
})

test('birthday zodiac and birthday-today rules remain unchanged', () => {
  assert.equal(getZodiacSignFromBirthday({ month: 5, day: 21 }), 'GEMINI')
  assert.equal(isBirthdayToday({ month: 2, day: 29 }, new Date('2028-02-29T04:00:00.000Z')), true)
  assert.equal(isBirthdayToday({ month: 2, day: 29 }, new Date('2027-02-28T04:00:00.000Z')), false)
})
