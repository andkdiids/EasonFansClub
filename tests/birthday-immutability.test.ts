import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  BIRTHDAY_ALREADY_SET,
  BirthdayAlreadySetError,
  isBirthdayConfigured,
  writeBirthdayOnce,
  type BirthdayRecord,
} from '@/lib/birthday-immutability'
import { isBirthdayToday, isValidBirthdayParts, getZodiacSignFromBirthday } from '@/lib/zodiac'

const read = (path: string) => readFileSync(path, 'utf8')

function createFakeBirthdayDb(initial: BirthdayRecord | null) {
  let row = initial ? { ...initial } : null

  const db = {
    user: {
      async updateMany(args: {
        where: { id: string; birthMonth: null; birthDay: null; birthdaySetAt: null }
        data: { birthMonth: number; birthDay: number; birthdaySetAt: Date }
      }) {
        if (
          row &&
          args.where.id === 'user-1' &&
          row.birthMonth === null &&
          row.birthDay === null &&
          row.birthdaySetAt === null
        ) {
          row = { ...row, ...args.data }
          return { count: 1 }
        }
        return { count: 0 }
      },
      async findUnique() {
        return row ? { ...row } : null
      },
    },
    current() {
      return row ? { ...row } : null
    },
  }

  return db
}

function blankBirthday(): BirthdayRecord {
  return { birthMonth: null, birthDay: null, birthdaySetAt: null }
}

function setBirthday(month: number, day: number): BirthdayRecord {
  return { birthMonth: month, birthDay: day, birthdaySetAt: new Date('2026-09-03T00:00:00.000Z') }
}

test('CASE 1: a new user can set a valid birthday exactly once', async () => {
  const db = createFakeBirthdayDb(blankBirthday())
  const result = await writeBirthdayOnce(db, 'user-1', { month: 5, day: 21 })

  assert.deepEqual(result, { status: 'set', birthday: { month: 5, day: 21 } })
  assert.deepEqual(db.current()?.birthMonth, 5)
  assert.deepEqual(db.current()?.birthDay, 21)
  assert.ok(db.current()?.birthdaySetAt instanceof Date)
})

test('CASE 2: submitting the same birthday is an allowed no-op', async () => {
  const existing = setBirthday(5, 21)
  const db = createFakeBirthdayDb(existing)
  const result = await writeBirthdayOnce(db, 'user-1', { month: 5, day: 21 })

  assert.deepEqual(result, { status: 'noop', birthday: { month: 5, day: 21 } })
  assert.deepEqual(db.current(), existing)
})

test('CASE 3/4: changing the day or month is rejected with BIRTHDAY_ALREADY_SET', async () => {
  for (const requested of [{ month: 5, day: 22 }, { month: 6, day: 21 }] as const) {
    const db = createFakeBirthdayDb(setBirthday(5, 21))
    await assert.rejects(
      writeBirthdayOnce(db, 'user-1', requested),
      (error: unknown) => error instanceof BirthdayAlreadySetError && error.code === BIRTHDAY_ALREADY_SET,
    )
  }
})

test('CASE 5: clearing an existing birthday is rejected', async () => {
  const db = createFakeBirthdayDb(setBirthday(5, 21))
  await assert.rejects(
    writeBirthdayOnce(db, 'user-1', null),
    (error: unknown) => error instanceof BirthdayAlreadySetError && error.code === BIRTHDAY_ALREADY_SET,
  )
  assert.deepEqual(db.current(), setBirthday(5, 21))
})

test('CASE 7: concurrent first sets allow only one winner and one stored birthday', async () => {
  const db = createFakeBirthdayDb(blankBirthday())
  const results = await Promise.allSettled([
    writeBirthdayOnce(db, 'user-1', { month: 5, day: 21 }),
    writeBirthdayOnce(db, 'user-1', { month: 7, day: 15 }),
  ])

  const winners = results.filter((result) => result.status === 'fulfilled')
  const failures = results.filter((result) => result.status === 'rejected')
  assert.equal(winners.length, 1)
  assert.equal(failures.length, 1)
  assert.equal((failures[0] as PromiseRejectedResult).reason.code, BIRTHDAY_ALREADY_SET)
  const stored = [db.current()?.birthMonth, db.current()?.birthDay]
  assert.ok([[5, 21], [7, 15]].some(([month, day]) => stored[0] === month && stored[1] === day))
})

test('CASES 6/8/9/10: the API and UI keep birthday writes separate from other profile settings', () => {
  const route = read('app/api/users/me/route.ts')
  const helper = read('lib/birthday-immutability.ts')
  const form = read('app/profile/ProfileSettingsForm.tsx')
  const dataBlock = route.slice(route.indexOf('const data:'), route.indexOf('if (body?.bio !== undefined)'))

  assert.match(route, /writeBirthdayOnce\(prisma, guard\.user\.id, requestedBirthday \|\| null, now\)/)
  assert.match(helper, /updateMany\(/)
  assert.match(helper, /birthMonth:\s*null/)
  assert.match(helper, /birthDay:\s*null/)
  assert.match(helper, /birthdaySetAt:\s*null/)
  assert.match(route, /birthdayPublic !== undefined\) data\.birthdayPublic = birthdayPublic/)
  assert.doesNotMatch(dataBlock, /birthMonth|birthDay|birthdaySetAt/)
  assert.match(form, /isBirthdayConfigured\(form\)/)
  assert.match(form, /const birthdayPayload = birthdayConfigured\s*\n\s*\? \{\}/)
  assert.match(form, /birthdayPublic: Boolean\(form\.birthdayPublic\)/)
})

test('CASE 10: any historical birthday value is read-only, even without birthdaySetAt', () => {
  assert.equal(isBirthdayConfigured({ birthMonth: 5, birthDay: 21, birthdaySetAt: null }), true)
  assert.equal(isBirthdayConfigured({ birthMonth: null, birthDay: null, birthdaySetAt: new Date() }), true)
  assert.equal(isBirthdayConfigured(blankBirthday()), false)
  assert.match(read('app/profile/ProfileSettingsForm.tsx'), /isBirthdayConfigured\(form\) \? \(/)
})

test('CASE 11/12: birthday validation accepts February 29 and rejects February 30', () => {
  assert.equal(isValidBirthdayParts({ month: 2, day: 29 }), true)
  assert.equal(isValidBirthdayParts({ month: 2, day: 30 }), false)
})

test('birthday zodiac and birthday-today rules remain unchanged', () => {
  assert.equal(getZodiacSignFromBirthday({ month: 5, day: 21 }), 'GEMINI')
  assert.equal(isBirthdayToday({ month: 2, day: 29 }, new Date('2028-02-29T04:00:00.000Z')), true)
  assert.equal(isBirthdayToday({ month: 2, day: 29 }, new Date('2027-02-28T04:00:00.000Z')), false)
})
