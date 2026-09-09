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
  getTasksByKind,
  getRewardRuleGroups,
} from '@/lib/growth-tasks/registry'
import { getCompletedCoreDayKeys, getLaunchGraceDayForWeek } from '@/lib/growth-tasks/progress'

test('统一成长注册表包含四项核心、三项主动行为、十一项之外和十六项新生活', () => {
  assert.equal(getCoreActiveTasks().length, 4)
  assert.equal(getActiveActionTasks().length, 3)
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

test('上线补偿只在 2026-09-07 这一周生效，且不伪造核心任务完成记录', () => {
  const coreCodes = getCoreActiveTasks().map((task) => task.code)
  const tuesday = new Date('2026-09-08T04:00:00.000Z')
  assert.equal(getLaunchGraceDayForWeek('2026-09-07', tuesday), '2026-09-07')
  assert.equal(getLaunchGraceDayForWeek('2026-09-14', tuesday), null)

  const mondayOnly = getCompletedCoreDayKeys('2026-09-07', [], tuesday)
  assert.deepEqual([...mondayOnly], ['2026-09-07'])

  const threeOfFour = coreCodes.slice(0, 3).map((taskCode) => ({ taskCode, periodKey: '2026-09-08' }))
  assert.equal(getCompletedCoreDayKeys('2026-09-07', threeOfFour, tuesday).size, 1)

  const fourOfFour = coreCodes.flatMap((taskCode): Array<{ taskCode: string; periodKey: string }> => taskCode === 'DAILY_COMMENT'
    ? Array.from({ length: 10 }, () => ({ taskCode, periodKey: '2026-09-08' }))
    : [{ taskCode, periodKey: '2026-09-08' }])
  assert.deepEqual([...getCompletedCoreDayKeys('2026-09-07', fourOfFour, tuesday)].sort(), ['2026-09-07', '2026-09-08'])
  assert.equal(getCompletedCoreDayKeys('2026-09-14', [], new Date('2026-09-14T04:00:00.000Z')).size, 0)
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
  assert.match(growthPanel, /<h3 id="growth-core-title">今天只做一件事<\/h3>/)
  assert.match(growthPanel, /<summary>之外/)
  assert.doesNotMatch(growthPanel, /<summary>支线/)
  assert.match(css, /\.friend-dock-primary-tabs[\s\S]*grid-template-columns: repeat\(4/)
})

test('奖励规则由统一注册表完整生成，覆盖今天只做一件事、之外和周奖励', () => {
  const groups = getRewardRuleGroups()
  assert.deepEqual(groups.map((group) => group.key), ['daily', 'passive', 'weekly'])
  assert.deepEqual(groups.map((group) => group.items.length), [7, 11, 3])
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
