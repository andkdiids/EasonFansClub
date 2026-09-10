import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  GROWTH_TASKS,
  TASK_SYSTEM_GRACE_DATE_KEY,
  TASK_SYSTEM_GRACE_WEEK_KEY,
  TASK_SYSTEM_LAUNCH_AT,
  TASK_SYSTEM_LAUNCH_DATE_KEY,
  WEEKLY_MILESTONES,
  getEconomyReport,
  getActiveActionTasks,
  getCoreActiveTasks,
  getPassiveTasks,
  getTodayTasks,
  getTasksByKind,
  getRewardRuleGroups,
} from '@/lib/growth-tasks/registry'
import { getCompletedDailyTaskDayKeys, getLaunchGraceDayForWeek } from '@/lib/growth-tasks/progress'
import { getDueWeeklyMilestones } from '@/lib/growth-tasks/service'

test('统一成长注册表包含四项核心、三项主动行为、十一项之外和十六项新生活', () => {
  assert.equal(getCoreActiveTasks().length, 4)
  assert.equal(getActiveActionTasks().length, 3)
  assert.equal(getTodayTasks().length, 7)
  assert.equal(getTasksByKind('active').length, 7)
  assert.equal(getTasksByKind('passive').length, 11)
  assert.equal(getTasksByKind('newLife').length, 16)
  assert.equal(GROWTH_TASKS.length, 34)
})

test('经济报告从注册表计算出产品约束中的总额', () => {
  const report = getEconomyReport()
  assert.equal(report.maxPassiveDaily, 35)
  assert.equal(report.maxPassiveWeekly, 308)
  assert.equal(report.weeklyMilestoneTotal, 151)
  // The sixteen line-item amounts in the product brief add up to 208;
  // keep the registry-derived report faithful to those amounts.
  assert.equal(report.newLifeTotal, 208)
  assert.deepEqual(WEEKLY_MILESTONES.map((item) => item.days), [3, 5, 7])
})

test('非资料类新生活项目从统一上线时间开始，资料完善允许历史刷新', () => {
  assert.equal(TASK_SYSTEM_LAUNCH_DATE_KEY, '2026-09-08')
  assert.equal(TASK_SYSTEM_GRACE_DATE_KEY, '2026-09-07')
  assert.equal(TASK_SYSTEM_GRACE_WEEK_KEY, '2026-09-07')
  assert.equal(TASK_SYSTEM_LAUNCH_AT.toISOString(), '2026-09-07T16:00:00.000Z')
  const profile = GROWTH_TASKS.find((task) => task.code === 'PROFILE_COMPLETE')
  const firstPost = GROWTH_TASKS.find((task) => task.code === 'FIRST_POST')
  assert.ok(profile && firstPost)
  assert.equal(profile?.eligibleFrom.getUTCFullYear(), 1970)
  assert.equal(firstPost?.eligibleFrom.toISOString(), TASK_SYSTEM_LAUNCH_AT.toISOString())
})

test('上线补偿只在 2026-09-07 这一周生效，且完整七项每日任务才算完成一天', () => {
  const todayCodes = getTodayTasks().map((task) => task.code)
  const tuesday = new Date('2026-09-08T04:00:00.000Z')
  assert.equal(getLaunchGraceDayForWeek('2026-09-07', tuesday), '2026-09-07')
  assert.equal(getLaunchGraceDayForWeek('2026-09-14', tuesday), null)

  const mondayOnly = getCompletedDailyTaskDayKeys('2026-09-07', [], tuesday)
  assert.deepEqual([...mondayOnly], ['2026-09-07'])

  const threeOfSeven = todayCodes.slice(0, 3).map((taskCode) => ({ taskCode, periodKey: '2026-09-08' }))
  assert.equal(getCompletedDailyTaskDayKeys('2026-09-07', threeOfSeven, tuesday).size, 1)

  const sevenOfSeven = getTodayTasks().flatMap((task): Array<{ taskCode: string; periodKey: string }> => task.dailyCap
    ? Array.from({ length: task.dailyCap }, () => ({ taskCode: task.code, periodKey: '2026-09-08' }))
    : [{ taskCode: task.code, periodKey: '2026-09-08' }])
  assert.deepEqual([...getCompletedDailyTaskDayKeys('2026-09-07', sevenOfSeven, tuesday)].sort(), ['2026-09-07', '2026-09-08'])
  assert.equal(getCompletedDailyTaskDayKeys('2026-09-14', [], new Date('2026-09-14T04:00:00.000Z')).size, 0)
})

test('奖励规则把本周奖励放在最顶部，并说明必须完成当天全部任务', () => {
  const groups = getRewardRuleGroups()
  assert.deepEqual(groups.map((group) => group.key), ['weekly', 'daily', 'passive'])
  assert.equal(groups[0]?.title, '本周奖励')
  assert.match(groups[0]?.description || '', /每天完成「今天只做一件事」中的全部任务/)
  assert.match(groups[0]?.description || '', /缺少任意一项则不增加本周进度|缺少任意一项未完成，则不增加本周进度/)
  assert.deepEqual(groups[0]?.items.map((item) => [item.milestoneDays, item.amount]), [[3, 27], [5, 50], [7, 74]])
})

/* Keep this explicit construction close to the registry tests as a guard
 * against accidentally reintroducing a hardcoded four-task denominator. */
test('today task resolver has no fixed four-task denominator', () => {
  const panel = readFileSync('components/GrowthPanel.tsx', 'utf8')
  const service = readFileSync('lib/growth-tasks/service.ts', 'utf8')
  assert.match(service, /getTodayTasks\(\)/)
  assert.match(panel, /overview\.today\.completed/)
  assert.match(panel, /overview\.today\.total/)
  assert.doesNotMatch(panel, /overview\.today\.coreCompleted/)
  assert.doesNotMatch(panel, /overview\.today\.coreTotal/)
})

/* Legacy four-task construction intentionally remains absent: a partial core
 * set must not complete a day now that action tasks are part of today's set. */
test('partial core rows alone do not complete a day', () => {
  const partialCoreRows = getCoreActiveTasks().map((task) => ({ taskCode: task.code, periodKey: '2026-09-08' }))
  const tuesday = new Date('2026-09-08T04:00:00.000Z')
  assert.equal(getCompletedDailyTaskDayKeys('2026-09-07', partialCoreRows, tuesday).size, 1)
})

test('新成长入口不把“任务”作为前台产品文案', () => {
  const friendDock = readFileSync('components/FriendDock.tsx', 'utf8')
  const growthPanel = readFileSync('components/GrowthPanel.tsx', 'utf8')
  const css = readFileSync('app/globals.css', 'utf8')
  assert.match(friendDock, /今天只做一件事/)
  assert.match(friendDock, /新生活/)
  assert.match(friendDock, /<\/button>[\s\S]*?>通讯录<\/button>[\s\S]*?>今天只做一件事<\/button>[\s\S]*?>新生活<\/button>/)
  assert.doesNotMatch(friendDock, /friend-dock-growth-links/)
  assert.doesNotMatch(friendDock, /任务中心|每日任务|一次性任务|任务列表/)
  assert.doesNotMatch(growthPanel, /任务中心|每日任务|一次性任务|任务列表|任务奖励|任务完成/)
  assert.doesNotMatch(growthPanel, /今天的四个动作|本周连续感|本周连续数|进行中|完整的脚印/)
  assert.match(growthPanel, /本周进度/)
  assert.doesNotMatch(growthPanel, />主动任务</)
  assert.match(growthPanel, /formatTodayProgress/)
  assert.match(growthPanel, /overview\.today\.items\.map/)
  assert.doesNotMatch(growthPanel, /activeActions/)
  assert.match(growthPanel, /<h3 id="growth-core-title">今天只做一件事<span className="growth-core-title-note">（每日必做）<\/span><\/h3>/)
  assert.match(growthPanel, /<summary>之外/)
  assert.doesNotMatch(growthPanel, /<summary>支线/)
  assert.match(css, /\.friend-dock-primary-tabs[\s\S]*grid-template-columns: repeat\(4/)
})

test('奖励规则由统一注册表完整生成，覆盖今天只做一件事、之外和周奖励', () => {
  const groups = getRewardRuleGroups()
  assert.deepEqual(groups.map((group) => group.key), ['weekly', 'daily', 'passive'])
  assert.deepEqual(groups.map((group) => group.items.length), [3, 7, 11])
  assert.equal(groups.find((group) => group.key === 'daily')?.title, '今天只做一件事')
  const active = groups.find((group) => group.key === 'daily')?.items.find((item) => item.code === 'PUBLISH_POST_ACTIVE')
  assert.equal(active?.amount, 2)
  assert.equal(active?.dailyCap, 1)
  assert.equal(active?.weeklyCap, 7)
  assert.equal(active?.maxWeeklyAmount, 14)
  const reply = groups.find((group) => group.key === 'daily')?.items.find((item) => item.code === 'DAILY_COMMENT')
  assert.equal(reply?.amount, 1)
  assert.equal(reply?.dailyCap, 10)
  const received = groups.find((group) => group.key === 'passive')?.items.find((item) => item.code === 'POST_COMMENT_RECEIVED')
  assert.equal(received?.amount, 2)
  assert.equal(received?.dailyCap, 5)
  assert.equal(received?.maxDailyAmount, 10)
  assert.equal(groups.find((group) => group.key === 'passive')?.title, '之外')
})

test('之外按真实 frequency 将每日任务排在每周任务前，并保留同周期相对顺序', () => {
  const passive = getPassiveTasks()
  const frequencies = passive.map((task) => task.frequency)
  assert.deepEqual(frequencies, [
    'daily', 'daily', 'daily', 'daily', 'daily', 'daily', 'daily',
    'weekly', 'weekly', 'weekly', 'weekly',
  ])
  assert.deepEqual(passive.map((task) => task.code), [
    'POST_LIKED',
    'POST_COMMENT_RECEIVED',
    'COMMENT_LIKED',
    'SALON_LIKED',
    'SONG_REVIEW_LIKED',
    'BEAD_LIKED',
    'LISTEN_DUEL_BRANCH',
    'POST_COLLECTED',
    'SALON_APPROVED',
    'SONG_REVIEW_CREATED',
    'BEAD_PUBLISHED',
  ])
})

test('周奖励采用三档累计，而不是只领取最高一档', () => {
  assert.equal(WEEKLY_MILESTONES.reduce((sum, item) => sum + item.reward, 0), 151)
})

test('周里程碑按最新完成天数即时补发所有未领取档位', () => {
  assert.deepEqual(getDueWeeklyMilestones(2, []), [])
  assert.deepEqual(getDueWeeklyMilestones(3, []), [{ days: 3, reward: 27 }])
  assert.deepEqual(getDueWeeklyMilestones(4, []), [{ days: 3, reward: 27 }])
  assert.deepEqual(getDueWeeklyMilestones(5, []), [{ days: 3, reward: 27 }, { days: 5, reward: 50 }])
  assert.deepEqual(getDueWeeklyMilestones(7, []), [
    { days: 3, reward: 27 },
    { days: 5, reward: 50 },
    { days: 7, reward: 74 },
  ])
  assert.deepEqual(getDueWeeklyMilestones(7, [
    { milestone: 3, claimedAt: new Date('2026-09-09T00:00:00.000Z') },
    { milestone: 5, claimedAt: new Date('2026-09-11T00:00:00.000Z') },
  ]), [{ days: 7, reward: 74 }])
})

test('周奖励完成链路在最新进度与流水写入后统一 reconcile，并保留幂等约束', () => {
  const service = readFileSync('lib/growth-tasks/service.ts', 'utf8')
  const checkin = readFileSync('app/api/checkin/route.ts', 'utf8')
  const prescription = readFileSync('lib/entertainment.ts', 'utf8')
  const replies = readFileSync('app/api/posts/[postId]/replies/route.ts', 'utf8')
  const panel = readFileSync('components/GrowthPanel.tsx', 'utf8')
  assert.match(service, /completedDays >= milestone\.days/)
  assert.match(service, /userId_weekKey_milestone/)
  assert.match(service, /awardRegistrationFee\(tx, \{/)
  assert.match(service, /resolveAndGrantWeeklyMilestones\(userId, now\)/)
  assert.match(checkin, /resolveAndGrantWeeklyMilestonesInTransaction\(tx, user\.id, checkedAt\)/)
  assert.match(prescription, /resolveAndGrantWeeklyMilestonesInTransaction\(tx, userId, now\)/)
  assert.match(replies, /resolveAndGrantWeeklyMilestonesInTransaction\(tx, user\.id, now\)/)
  assert.doesNotMatch(panel, /claim\(\{ milestone:/)
})
