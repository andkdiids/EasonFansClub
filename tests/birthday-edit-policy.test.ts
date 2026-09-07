import assert from 'node:assert/strict'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import {
  BIRTHDATE_SELF_EDIT_EXHAUSTED,
  BirthdaySelfEditExhaustedError,
  getBirthdayEditState,
  updateUserBirthdate,
  type BirthdayRecord,
} from '@/lib/birthday-immutability'

type FakeRow = Omit<Required<BirthdayRecord>, 'birthdateSelfEditCount'> & { birthdateSelfEditCount: number }

function fakeDb(initial: FakeRow): Prisma.TransactionClient {
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
        if (key in args.where && row[key] !== args.where[key]) return { count: 0 }
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

function blank(): FakeRow {
  return { birthMonth: null, birthDay: null, birthdaySetAt: null, birthdateSelfEditCount: 0 }
}

function birthday(month: number, day: number, count = 0): FakeRow {
  return { birthMonth: month, birthDay: day, birthdaySetAt: new Date('2026-09-01T00:00:00.000Z'), birthdateSelfEditCount: count }
}

test('生日编辑状态：首次设置不消耗本人修改机会，历史生日默认保留一次', () => {
  assert.deepEqual(getBirthdayEditState(blank()), {
    hasBirthdate: false,
    birthdateSelfEditCount: 0,
    birthdateEditUsed: false,
    canEditBirthdate: true,
    birthdayEditRemaining: 1,
  })
  assert.equal(getBirthdayEditState(birthday(5, 21)).canEditBirthdate, true)
  assert.equal(getBirthdayEditState(birthday(5, 21, 1)).canEditBirthdate, false)
})

test('本人首次设置、唯一一次修改和第二次修改拦截', async () => {
  const db = fakeDb(blank())
  const first = await updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 7, day: 15 }, actor: 'SELF' })
  assert.equal(first.status, 'set')
  assert.equal(first.birthdateSelfEditCount, 0)

  const second = await updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 7, day: 16 }, actor: 'SELF' })
  assert.equal(second.status, 'updated')
  assert.equal(second.birthdateSelfEditCount, 1)

  await assert.rejects(
    updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 7, day: 17 }, actor: 'SELF' }),
    (error: unknown) => error instanceof BirthdaySelfEditExhaustedError && error.code === BIRTHDATE_SELF_EDIT_EXHAUSTED,
  )
})

test('本人提交相同生日是 no-op，不消耗次数', async () => {
  const db = fakeDb(birthday(7, 16, 1))
  const result = await updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 7, day: 16 }, actor: 'SELF' })
  assert.equal(result.status, 'noop')
  assert.equal(result.changed, false)
  assert.equal(result.birthdateSelfEditCount, 1)
})

test('历史用户 count=0 可以修改，2 月 29 日合法', async () => {
  const db = fakeDb(birthday(2, 28, 0))
  const result = await updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 2, day: 29 }, actor: 'SELF' })
  assert.equal(result.status, 'updated')
  assert.equal(result.birthdateSelfEditCount, 1)
})

test('两个并发本人修改最多一个成功', async () => {
  const db = fakeDb(birthday(5, 21, 0))
  const results = await Promise.allSettled([
    updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 7, day: 15 }, actor: 'SELF' }),
    updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 8, day: 20 }, actor: 'SELF' }),
  ])
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1)
  assert.equal((results.find((item) => item.status === 'rejected') as PromiseRejectedResult).reason.code, BIRTHDATE_SELF_EDIT_EXHAUSTED)
})

test('管理员修改生日不消耗或重置本人修改次数', async () => {
  const db = fakeDb(birthday(7, 15, 1))
  const result = await updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 8, day: 20 }, actor: 'ADMIN' })
  assert.equal(result.changed, true)
  assert.equal(result.birthdateSelfEditCount, 1)
  await assert.rejects(
    updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 9, day: 7 }, actor: 'SELF' }),
    BirthdaySelfEditExhaustedError,
  )
})

test('生日服务拒绝不完整或非法日期', async () => {
  const db = fakeDb(blank())
  await assert.rejects(updateUserBirthdate(db, { targetUserId: 'user-1', birthdate: { month: 2, day: 30 }, actor: 'SELF' }), /INVALID_BIRTHDAY/)
})
