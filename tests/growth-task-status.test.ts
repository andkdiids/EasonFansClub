import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getCoreActiveTasks } from '@/lib/growth-tasks/registry'
import { getCompletedCoreDayKeys, resolveTodayTaskProgress } from '@/lib/growth-tasks/progress'

const TODAY = '2026-09-08'
const read = (path: string) => readFileSync(path, 'utf8')

function resolveToday(overrides: Partial<Parameters<typeof resolveTodayTaskProgress>[0]> = {}) {
  return resolveTodayTaskProgress({
    dateKey: TODAY,
    completionRows: [],
    businessFacts: { checkinDateKeys: [], prescriptionDateKeys: [] },
    actionProgress: [
      { taskCode: 'POST_LIKE_ACTIVE', progress: 0, earned: 0, cap: 5 },
      { taskCode: 'CONTENT_SHARE_ACTIVE', progress: 0, earned: 0, cap: 1 },
      { taskCode: 'PUBLISH_POST_ACTIVE', progress: 0, earned: 0, cap: 1 },
    ],
    ...overrides,
  })
}

function status(result: ReturnType<typeof resolveTodayTaskProgress>, code: string) {
  return result.tasks.find((task) => task.code === code)
}

test('签到和处方事实在任务实例缺失时仍恢复今天状态，核心进度为 2/4', () => {
  const result = resolveToday({
    businessFacts: { checkinDateKeys: [TODAY], prescriptionDateKeys: [TODAY] },
  })
  assert.equal(result.total, 7)
  assert.equal(result.completed, 2)
  assert.equal(result.coreTotal, 4)
  assert.equal(result.coreCompleted, 2)
  assert.equal(status(result, 'DAILY_CHECKIN')?.completed, true)
  assert.equal(status(result, 'DAILY_PRESCRIPTION')?.completed, true)
  assert.equal(status(result, 'DAILY_GAME')?.completed, false)
  assert.equal(status(result, 'DAILY_COMMENT')?.completed, false)
})

test('已有任务完成记录按进度目标完成，不能把一次回复当成 10/10', () => {
  const coreCodes = getCoreActiveTasks().map((task) => task.code)
  const result = resolveToday({
    completionRows: coreCodes.flatMap((taskCode): Array<{ taskCode: string; periodKey: string }> => taskCode === 'DAILY_COMMENT'
      ? Array.from({ length: 10 }, () => ({ taskCode, periodKey: TODAY }))
      : [{ taskCode, periodKey: TODAY }]),
  })
  assert.equal(result.total, 7)
  assert.equal(result.completed, 4)
  assert.equal(status(result, 'DAILY_GAME')?.completed, true)
  assert.equal(status(result, 'DAILY_COMMENT')?.completed, true)
})

test('娱乐天空任务按当天首次游戏完成封顶为 1/1', () => {
  const oneGame = resolveToday({
    businessFacts: {
      checkinDateKeys: [],
      prescriptionDateKeys: [],
      gameCompletionCountsByDate: new Map([[TODAY, 1]]),
    },
  })
  assert.equal(status(oneGame, 'DAILY_GAME')?.progress, 1)
  assert.equal(status(oneGame, 'DAILY_GAME')?.cap, 1)
  assert.equal(status(oneGame, 'DAILY_GAME')?.completed, true)

  const multipleGames = resolveToday({
    businessFacts: {
      checkinDateKeys: [],
      prescriptionDateKeys: [],
      gameCompletionCountsByDate: new Map([[TODAY, 2]]),
    },
  })
  assert.equal(status(multipleGames, 'DAILY_GAME')?.progress, 1)
  assert.equal(status(multipleGames, 'DAILY_GAME')?.cap, 1)
  assert.equal(status(multipleGames, 'DAILY_GAME')?.completed, true)
})

test('补签历史日期不误判今天，正常当天挂号才算今天完成', () => {
  const makeup = resolveToday({ businessFacts: { checkinDateKeys: ['2026-09-05'] } })
  assert.equal(status(makeup, 'DAILY_CHECKIN')?.completed, false)

  const normal = resolveToday({ businessFacts: { checkinDateKeys: [TODAY] } })
  assert.equal(status(normal, 'DAILY_CHECKIN')?.completed, true)
})

test('点赞和分享以整项达标计数，不把每次事件拆成多个今日任务', () => {
  const fourLikes = resolveToday({
    actionProgress: [
      { taskCode: 'POST_LIKE_ACTIVE', progress: 4, earned: 4, cap: 5 },
      { taskCode: 'CONTENT_SHARE_ACTIVE', progress: 0, earned: 0, cap: 1 },
    ],
  })
  assert.equal(fourLikes.total, 7)
  assert.equal(fourLikes.completed, 0)
  assert.equal(status(fourLikes, 'POST_LIKE_ACTIVE')?.completed, false)

  const fiveLikes = resolveToday({
    actionProgress: [
      { taskCode: 'POST_LIKE_ACTIVE', progress: 5, earned: 5, cap: 5 },
      { taskCode: 'CONTENT_SHARE_ACTIVE', progress: 0, earned: 0, cap: 1 },
      { taskCode: 'PUBLISH_POST_ACTIVE', progress: 0, earned: 0, cap: 1 },
    ],
  })
  assert.equal(fiveLikes.completed, 1)
  assert.equal(status(fiveLikes, 'POST_LIKE_ACTIVE')?.completed, true)

  const oneShare = resolveToday({
    actionProgress: [
      { taskCode: 'POST_LIKE_ACTIVE', progress: 0, earned: 0, cap: 5 },
      { taskCode: 'CONTENT_SHARE_ACTIVE', progress: 1, earned: 2, cap: 1 },
      { taskCode: 'PUBLISH_POST_ACTIVE', progress: 0, earned: 0, cap: 1 },
    ],
  })
  assert.equal(oneShare.completed, 1)
  assert.equal(status(oneShare, 'CONTENT_SHARE_ACTIVE')?.completed, true)
})

test('核心和三项主动奖励任务全部完成时返回 7/7 列表进度，核心仍为 4/4', () => {
  const result = resolveToday({
    completionRows: getCoreActiveTasks().flatMap((task): Array<{ taskCode: string; periodKey: string }> => task.code === 'DAILY_COMMENT'
      ? Array.from({ length: 10 }, () => ({ taskCode: task.code, periodKey: TODAY }))
      : [{ taskCode: task.code, periodKey: TODAY }]),
    actionProgress: [
      { taskCode: 'POST_LIKE_ACTIVE', progress: 5, earned: 5, cap: 5 },
      { taskCode: 'CONTENT_SHARE_ACTIVE', progress: 1, earned: 2, cap: 1 },
      { taskCode: 'PUBLISH_POST_ACTIVE', progress: 1, earned: 2, cap: 1 },
    ],
  })
  assert.equal(result.total, 7)
  assert.equal(result.completed, 7)
  assert.equal(result.coreTotal, 4)
  assert.equal(result.coreCompleted, 4)
})

test('进度型任务统一以 current >= target 决定完成状态', () => {
  const oneCompletionRow = resolveToday({
    completionRows: [{ taskCode: 'DAILY_COMMENT', periodKey: TODAY }],
  })
  assert.equal(status(oneCompletionRow, 'DAILY_COMMENT')?.progress, 1)
  assert.equal(status(oneCompletionRow, 'DAILY_COMMENT')?.completed, false)

  for (const current of [0, 1, 5, 9]) {
    const result = resolveToday({
      businessFacts: {
        checkinDateKeys: [],
        prescriptionDateKeys: [],
        commentRewardCountsByDate: new Map([[TODAY, current]]),
      },
    })
    assert.equal(status(result, 'DAILY_COMMENT')?.progress, current)
    assert.equal(status(result, 'DAILY_COMMENT')?.cap, 10)
    assert.equal(status(result, 'DAILY_COMMENT')?.completed, false)
    assert.equal(result.coreCompleted, 0)
  }

  const tenReplies = resolveToday({
    businessFacts: {
      checkinDateKeys: [],
      prescriptionDateKeys: [],
      commentRewardCountsByDate: new Map([[TODAY, 10]]),
    },
  })
  assert.equal(status(tenReplies, 'DAILY_COMMENT')?.progress, 10)
  assert.equal(status(tenReplies, 'DAILY_COMMENT')?.completed, true)

  const partialActions = resolveToday({
    actionProgress: [
      { taskCode: 'POST_LIKE_ACTIVE', progress: 1, earned: 1, cap: 5 },
      { taskCode: 'CONTENT_SHARE_ACTIVE', progress: 0, earned: 0, cap: 1 },
      { taskCode: 'PUBLISH_POST_ACTIVE', progress: 0, earned: 0, cap: 1 },
    ],
  })
  assert.equal(status(partialActions, 'POST_LIKE_ACTIVE')?.completed, false)
  assert.equal(status(partialActions, 'CONTENT_SHARE_ACTIVE')?.completed, false)
  assert.equal(status(partialActions, 'PUBLISH_POST_ACTIVE')?.completed, false)
})

test('周进度用真实签到和处方日期补齐同一天，而不写入任务完成记录', () => {
  const rows = [
    { taskCode: 'DAILY_GAME', periodKey: TODAY },
    { taskCode: 'DAILY_COMMENT', periodKey: TODAY },
  ]
  const completedDays = getCompletedCoreDayKeys('2026-09-07', rows, new Date('2026-09-08T04:00:00.000Z'), {
    checkinDateKeys: [TODAY],
    prescriptionDateKeys: [TODAY],
    commentRewardCountsByDate: new Map([[TODAY, 10]]),
  })
  assert.equal(completedDays.has(TODAY), true)

  const partialDay = getCompletedCoreDayKeys('2026-09-07', rows, new Date('2026-09-08T04:00:00.000Z'), {
    checkinDateKeys: [TODAY],
    prescriptionDateKeys: [TODAY],
    commentRewardCountsByDate: new Map([[TODAY, 5]]),
  })
  assert.equal(partialDay.has(TODAY), false)
})

test('overview 读取业务事实但不在读取时补任务、派奖或通知', () => {
  const service = read('lib/growth-tasks/service.ts')
  const overview = service.slice(service.indexOf('export async function getGrowthOverview'))
  assert.match(service, /tx\.checkIn\.findMany/)
  assert.match(service, /tx\.entertainmentDailyDraw\.findMany/)
  assert.match(overview, /prisma\.checkIn\.findMany/)
  assert.match(overview, /prisma\.entertainmentDailyDraw\.findMany/)
  assert.match(overview, /prisma\.pointLog\.findMany/)
  assert.match(overview, /guessSongDuelMatch\.count/)
  assert.match(overview, /resolveTodayTaskProgress/)
  assert.doesNotMatch(overview, /completeTask\(/)
  assert.doesNotMatch(overview, /grantGrowthReward\(/)
  assert.doesNotMatch(overview, /notification/i)
})

test('前端只消费服务端的核心今日进度，并将全部今日任务渲染为一个列表', () => {
  const panel = read('components/GrowthPanel.tsx')
  assert.match(panel, /today: \{\s+dateKey: string\s+total: number\s+completed: number/)
  assert.match(panel, /overview\.today\.coreCompleted/)
  assert.match(panel, /overview\.today\.coreTotal/)
  assert.match(panel, /overview\.today\.items\.map/)
  assert.doesNotMatch(panel, /today\.activeActions/)
  assert.doesNotMatch(panel, />主动任务</)
  assert.doesNotMatch(panel, />被动奖励</)
})
