import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getShanghaiWeekKey } from '../lib/community-rewards'
import { getRegistrationFeeHistoryWindow } from '../lib/registration-fee'

const read = (path: string) => readFileSync(path, 'utf8')

test('挂号费记录筛选使用北京时间的今日、昨日、本周和自定义日期边界', () => {
  const now = new Date('2026-09-10T04:00:00.000Z')

  const today = getRegistrationFeeHistoryWindow({ range: 'today', now })
  assert.equal(today.dateKey, '2026-09-10')
  assert.equal(today.start?.toISOString(), '2026-09-09T16:00:00.000Z')
  assert.equal(today.end?.toISOString(), '2026-09-10T16:00:00.000Z')

  const yesterday = getRegistrationFeeHistoryWindow({ range: 'yesterday', now })
  assert.equal(yesterday.dateKey, '2026-09-09')
  assert.equal(yesterday.start?.toISOString(), '2026-09-08T16:00:00.000Z')
  assert.equal(yesterday.end?.toISOString(), '2026-09-09T16:00:00.000Z')

  const week = getRegistrationFeeHistoryWindow({ range: 'week', now })
  assert.equal(week.dateKey, getShanghaiWeekKey(now))
  assert.equal(week.dateKey, '2026-09-07')
  assert.equal(week.start?.toISOString(), '2026-09-06T16:00:00.000Z')
  assert.equal(week.end?.toISOString(), '2026-09-13T16:00:00.000Z')

  const custom = getRegistrationFeeHistoryWindow({ range: 'date', dateKey: '2026-09-01', now })
  assert.equal(custom.dateKey, '2026-09-01')
  assert.equal(custom.start?.toISOString(), '2026-08-31T16:00:00.000Z')
  assert.equal(custom.end?.toISOString(), '2026-09-01T16:00:00.000Z')
  assert.throws(() => getRegistrationFeeHistoryWindow({ range: 'date', dateKey: '2026-02-30' }), /INVALID_REGISTRATION_FEE_HISTORY_DATE/)
})

test('Growth 面板把余额、记录入口和动态每日进度放在正确区域', () => {
  const panel = read('components/GrowthPanel.tsx')
  const dialog = read('components/RegistrationFeeHistoryDialog.tsx')
  const route = read('app/api/points/history/route.ts')

  assert.match(panel, /className="growth-asset-row"/)
  assert.match(panel, /医保余额[\s\S]*overview\.points/)
  assert.match(panel, /setFeeHistoryOpen\(true\)/)
  assert.match(panel, /挂号费记录/)
  assert.doesNotMatch(panel, /<div className="growth-summary-line"><span>今日<\/span>/)
  assert.match(panel, /growth-core-title-progress[\s\S]*completedToday[\s\S]*totalTodayTasks/)
  assert.match(dialog, /createPortal/)
  assert.match(dialog, /今日/)
  assert.match(dialog, /昨日/)
  assert.match(dialog, /本周/)
  assert.match(dialog, /选择日期/)
  assert.match(dialog, /onScroll=\{handleListScroll\}/)
  assert.match(dialog, /range: nextRange/)
  assert.doesNotMatch(dialog, /type="date"/)
  assert.match(route, /searchParams\.get\('range'\)/)
  assert.match(route, /searchParams\.get\('date'\)/)
})
