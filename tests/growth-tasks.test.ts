import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  GROWTH_TASKS,
  TASK_SYSTEM_LAUNCH_AT,
  WEEKLY_MILESTONES,
  getEconomyReport,
  getTasksByKind,
} from '@/lib/growth-tasks/registry'

test('统一成长注册表包含四项主动、九项被动和十六项新生活', () => {
  assert.equal(getTasksByKind('active').length, 4)
  assert.equal(getTasksByKind('passive').length, 9)
  assert.equal(getTasksByKind('newLife').length, 16)
  assert.equal(GROWTH_TASKS.length, 29)
})

test('经济报告从注册表计算出产品约束中的总额', () => {
  const report = getEconomyReport()
  assert.equal(report.maxPassiveDaily, 25)
  assert.equal(report.maxPassiveWeekly, 238)
  assert.equal(report.weeklyMilestoneTotal, 151)
  // The sixteen line-item amounts in the product brief add up to 208;
  // keep the registry-derived report faithful to those amounts.
  assert.equal(report.newLifeTotal, 208)
  assert.deepEqual(WEEKLY_MILESTONES.map((item) => item.days), [3, 5, 7])
})

test('非资料类新生活项目从统一上线时间开始，资料完善允许历史刷新', () => {
  assert.equal(TASK_SYSTEM_LAUNCH_AT.toISOString(), '2026-09-06T16:00:00.000Z')
  const profile = GROWTH_TASKS.find((task) => task.code === 'PROFILE_COMPLETE')
  const firstPost = GROWTH_TASKS.find((task) => task.code === 'FIRST_POST')
  assert.ok(profile && firstPost)
  assert.equal(profile?.eligibleFrom.getUTCFullYear(), 1970)
  assert.equal(firstPost?.eligibleFrom.toISOString(), TASK_SYSTEM_LAUNCH_AT.toISOString())
})

test('新成长入口不把“任务”作为前台产品文案', () => {
  const friendDock = readFileSync('components/FriendDock.tsx', 'utf8')
  const growthPanel = readFileSync('components/GrowthPanel.tsx', 'utf8')
  assert.match(friendDock, /今天只做一件事/)
  assert.match(friendDock, /新生活/)
  assert.doesNotMatch(friendDock, /任务中心|每日任务|一次性任务|任务列表/)
  assert.doesNotMatch(growthPanel, /任务中心|每日任务|一次性任务|任务列表|任务奖励|任务完成/)
})

test('周奖励采用三档累计，而不是只领取最高一档', () => {
  assert.equal(WEEKLY_MILESTONES.reduce((sum, item) => sum + item.reward, 0), 151)
})
