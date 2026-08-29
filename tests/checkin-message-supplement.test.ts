import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CheckInMessageSupplementError,
  type CheckInMessageSupplementDatabase,
  supplementTodayCheckInMessage,
} from '../lib/checkin-message-supplement'
import { getShanghaiDateKey } from '../lib/checkin'

const read = (path: string) => readFileSync(path, 'utf8')
const now = new Date('2026-08-30T08:00:00.000Z')

type FakeState = {
  checkIn: {
    id: string
    userId: string
    checkinDateKey: string
    checkDate: Date
    points: number
    exp: number
    mood: string | null
    moodType: string | null
    moodEmoji: string | null
    moodText: string | null
    message: string | null
    streakDay: number
    createdAt: Date
    type: 'NORMAL' | 'MAKEUP_FREE_QUIZ' | 'MAKEUP_PAID' | 'MAKEUP_ADMIN'
    isMakeUp: boolean
  } | null
  dailyMessage: { id: string } | null
  friendActivity: { content: string | null; dailyMessageId: string | null; targetUrl: string | null }
}

function createFakeDatabase(initial: FakeState['checkIn'] = createCheckIn()) {
  const state: FakeState = {
    checkIn: initial,
    dailyMessage: null,
    friendActivity: { content: null, dailyMessageId: null, targetUrl: null },
  }
  const calls = { updateMany: 0, dailyMessageCreate: 0, friendActivityUpdateMany: 0 }
  const database = {
    checkIn: {
      findUnique: async ({ where }: { where: { userId_checkinDateKey: { userId: string; checkinDateKey: string } } }) => {
        const key = where.userId_checkinDateKey
        if (!state.checkIn || state.checkIn.userId !== key.userId || state.checkIn.checkinDateKey !== key.checkinDateKey) return null
        return { ...state.checkIn, DailyMessage: state.dailyMessage }
      },
      updateMany: async ({ data }: { data: { message: string } }) => {
        calls.updateMany += 1
        await Promise.resolve()
        if (!state.checkIn || state.checkIn.message !== null && state.checkIn.message !== '' || state.dailyMessage) return { count: 0 }
        state.checkIn.message = data.message
        return { count: 1 }
      },
    },
    dailyMessage: {
      create: async () => {
        calls.dailyMessageCreate += 1
        const id = `daily-message-${calls.dailyMessageCreate}`
        state.dailyMessage = { id }
        return { id }
      },
    },
    friendActivity: {
      updateMany: async ({ data }: { data: { content: string; dailyMessageId: string; targetUrl: string } }) => {
        calls.friendActivityUpdateMany += 1
        state.friendActivity = data
        return { count: 1 }
      },
    },
  } as unknown as CheckInMessageSupplementDatabase

  return { database, state, calls }
}

function createCheckIn(overrides: Partial<NonNullable<FakeState['checkIn']> & { checkinDateKey: string }> = {}) {
  return {
    id: 'check-in-1',
    userId: 'user-1',
    checkinDateKey: getShanghaiDateKey(now),
    checkDate: now,
    points: 7,
    exp: 5,
    mood: 'happy',
    moodType: 'PRESET',
    moodEmoji: null,
    moodText: null,
    message: null,
    streakDay: 4,
    createdAt: now,
    type: 'NORMAL' as const,
    isMakeUp: false,
    ...overrides,
  }
}

async function rejectWithCode(promise: Promise<unknown>, code: CheckInMessageSupplementError['code']) {
  await assert.rejects(promise, (error: unknown) => error instanceof CheckInMessageSupplementError && error.code === code)
}

test('当天正常挂号的第一次补写只更新留言并保留心情与奖励快照', async () => {
  const { database, state, calls } = createFakeDatabase()
  const result = await supplementTodayCheckInMessage(database, { userId: 'user-1', message: '今天去看了电影，很开心。', now })

  assert.equal(result.checkIn.message, '今天去看了电影，很开心。')
  assert.equal(result.checkIn.mood, 'happy')
  assert.equal(result.checkIn.points, 7)
  assert.equal(result.checkIn.exp, 5)
  assert.equal(result.checkIn.streakDay, 4)
  assert.equal(state.checkIn?.mood, 'happy')
  assert.equal(state.checkIn?.points, 7)
  assert.equal(state.checkIn?.exp, 5)
  assert.equal(state.checkIn?.streakDay, 4)
  assert.equal(calls.updateMany, 1)
  assert.equal(calls.dailyMessageCreate, 1)
  assert.equal(calls.friendActivityUpdateMany, 1)
  assert.equal(result.dailyMessageId, 'daily-message-1')
})

test('没有当天挂号、昨天挂号和其他用户记录都不能补写', async () => {
  await rejectWithCode(supplementTodayCheckInMessage(createFakeDatabase(null).database, { userId: 'user-1', message: '留言', now }), 'TODAY_CHECKIN_NOT_FOUND')

  const yesterday = createFakeDatabase(createCheckIn({ checkinDateKey: '2026-08-29' }))
  await rejectWithCode(supplementTodayCheckInMessage(yesterday.database, { userId: 'user-1', message: '留言', now }), 'TODAY_CHECKIN_NOT_FOUND')

  const otherUser = createFakeDatabase(createCheckIn({ userId: 'user-2' }))
  await rejectWithCode(supplementTodayCheckInMessage(otherUser.database, { userId: 'user-1', message: '留言', now }), 'TODAY_CHECKIN_NOT_FOUND')
})

test('已有留言或历史留言投影存在时不显示可补写语义，也不能再次调用', async () => {
  const existingMessage = createFakeDatabase(createCheckIn({ message: '早上已经写过' }))
  await rejectWithCode(supplementTodayCheckInMessage(existingMessage.database, { userId: 'user-1', message: '第二条', now }), 'MESSAGE_ALREADY_EXISTS')
  assert.equal(existingMessage.calls.updateMany, 0)

  const previouslySupplemented = createFakeDatabase(createCheckIn())
  previouslySupplemented.state.dailyMessage = { id: 'old-daily-message' }
  await rejectWithCode(supplementTodayCheckInMessage(previouslySupplemented.database, { userId: 'user-1', message: '第二次', now }), 'MESSAGE_ALREADY_SUPPLEMENTED')
  assert.equal(previouslySupplemented.calls.updateMany, 0)
})

test('管理员、付费和免费补签记录不获得当天留言补写入口', async () => {
  for (const type of ['MAKEUP_ADMIN', 'MAKEUP_PAID', 'MAKEUP_FREE_QUIZ'] as const) {
    const makeup = createFakeDatabase(createCheckIn({ type, isMakeUp: true }))
    await rejectWithCode(supplementTodayCheckInMessage(makeup.database, { userId: 'user-1', message: '不应写入', now }), 'TODAY_CHECKIN_NOT_ELIGIBLE')
    assert.equal(makeup.calls.updateMany, 0)
  }
})

test('空字符串、纯空格和超长留言在服务端都被拒绝', async () => {
  for (const message of ['', '   ', 'a'.repeat(301)]) {
    const fixture = createFakeDatabase()
    await rejectWithCode(supplementTodayCheckInMessage(fixture.database, { userId: 'user-1', message, now }), 'INVALID_MESSAGE')
    assert.equal(fixture.calls.updateMany, 0)
  }
})

test('两个并发补写请求最多一个成功，第二次服务端直接拒绝且不产生第二条留言', async () => {
  const fixture = createFakeDatabase()
  const results = await Promise.allSettled([
    supplementTodayCheckInMessage(fixture.database, { userId: 'user-1', message: '先到的留言', now }),
    supplementTodayCheckInMessage(fixture.database, { userId: 'user-1', message: '重试的留言', now }),
  ])

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  assert.equal(fixture.calls.updateMany, 2)
  assert.equal(fixture.calls.dailyMessageCreate, 1)
  assert.equal(fixture.state.dailyMessage?.id, 'daily-message-1')
  assert.ok(fixture.state.checkIn?.message === '先到的留言' || fixture.state.checkIn?.message === '重试的留言')
})

test('路由只接受当前登录用户的 message，使用统一上海日期并且不触发奖励', () => {
  const route = read('app/api/checkin/message/route.ts')
  const service = read('lib/checkin-message-supplement.ts')
  const button = read('components/CheckInButton.tsx')
  const checkInRoute = read('app/api/checkin/route.ts')

  assert.match(route, /requireUser\(\)/)
  assert.match(route, /body\?\.message/)
  assert.doesNotMatch(route, /body\?\.userId|searchParams\.get\('userId'\)/)
  assert.match(route, /prisma\.\$transaction\(\(tx\) => supplementTodayCheckInMessage\(tx/)
  assert.match(service, /getShanghaiDateKey\(now\)/)
  assert.match(service, /checkinDateKey: todayKey/)
  assert.match(service, /userId: input\.userId/)
  assert.match(service, /updateMany\(/)
  assert.match(service, /OR: \[\{ message: null \}, \{ message: '' \}\]/)
  assert.match(button, /fetch\('\/api\/checkin\/message'/)
  assert.match(button, /body: JSON\.stringify\(\{ message: supplementDraft \}\)/)
  assert.doesNotMatch(button.slice(button.indexOf('async function supplementMessage'), button.indexOf('function renderMessageSupplement')), /mood|points|exp|streak|award|PointLog|balance/i)
  assert.doesNotMatch(service, /awardRegistrationFee|awardExperience|pointLog|user\.update|data: \{[^}]*streakDay/)
  assert.match(checkInRoute, /awardRegistrationFee\(tx/)
})

test('补写成功后前端立即显示内容、隐藏入口并发出现有留言墙投影的完成事件', () => {
  const button = read('components/CheckInButton.tsx')
  const page = read('app/checkin/page.tsx')
  const route = read('app/api/checkin/message/route.ts')

  assert.match(button, /补写留言/)
  assert.match(button, /补写今日留言/)
  assert.match(button, /今天还想留下些什么吗？/)
  assert.match(button, /保存留言/)
  assert.match(button, /setTodayCheckIn\(nextCheckIn\)/)
  assert.match(button, /setSupplementOpen\(false\)/)
  assert.match(button, /setSupplementNotice\('留言已补写'\)/)
  assert.match(button, /dailyMessage: data\.dailyMessage \|\| null/)
  assert.match(button, /todayCheckIn\.type === 'NORMAL'/)
  assert.match(button, /!todayCheckIn\.dailyMessageId/)
  assert.match(button, /!todayCheckIn\.message\?\.trim\(\)/)
  assert.match(page, /type: true, isMakeUp: true/)
  assert.match(route, /invalidateCheckInMessagesCache\(\)/)
  assert.match(route, /dailyMessageId: result\.dailyMessageId/)
})

test('统一时区在午夜边界前后返回不同日期键', () => {
  assert.equal(getShanghaiDateKey(new Date('2026-08-30T15:59:59.999Z')), '2026-08-30')
  assert.equal(getShanghaiDateKey(new Date('2026-08-30T16:00:00.000Z')), '2026-08-31')
})
