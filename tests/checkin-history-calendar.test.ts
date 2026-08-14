import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  compareCheckInMonths,
  getCheckInCalendarCells,
  getCheckInMonthBounds,
  getCheckInMonthKey,
  parseCheckInDateKey,
  shiftCheckInMonth,
} from '../lib/checkin-history'

const read = (path: string) => readFileSync(path, 'utf8')
const page = read('app/checkin/page.tsx')
const surface = read('components/CheckInLayoutSurface.tsx')
const dialog = read('components/CheckInHistoryDialog.tsx')
const monthRoute = read('app/api/checkin/history/route.ts')
const detailRoute = read('app/api/checkin/history/[dateKey]/route.ts')
const schema = read('prisma/schema.prisma')
const css = read('app/globals.css')

test('CheckIn 历史直接复用现有字段，不需要新增 Prisma 模型或字段', () => {
  assert.match(schema, /model CheckIn \{[\s\S]*?checkinDateKey\s+String[\s\S]*?message\s+String\?[\s\S]*?mood\s+String\?/)
  assert.match(page, /checkInHistory = await|checkInHistory/)
  assert.doesNotMatch(monthRoute, /userId.*searchParams|searchParams.*userId/)
  assert.match(monthRoute, /user\.id/)
  assert.match(detailRoute, /userId_checkinDateKey: \{ userId: user\.id, checkinDateKey: dateKey \}/)
})

test('月历生成完整六行，星期日开始并正确处理闰年', () => {
  const august = getCheckInCalendarCells(2026, 8)
  assert.equal(august.length, 42)
  assert.equal(august[0].key, '2026-07-26')
  assert.equal(august[6].key, '2026-08-01')
  assert.equal(august[34].key, '2026-08-29')
  assert.equal(getCheckInCalendarCells(2024, 2).filter((cell) => cell.isCurrentMonth).length, 29)
  assert.equal(getCheckInCalendarCells(2025, 2).filter((cell) => cell.isCurrentMonth).length, 28)
})

test('日期键和月份切换使用纯日历值，不受 UTC 跨日影响', () => {
  assert.deepEqual(parseCheckInDateKey('2026-08-14'), { key: '2026-08-14', year: 2026, month: 8, day: 14 })
  assert.equal(parseCheckInDateKey('2026-02-29'), null)
  assert.deepEqual(getCheckInMonthBounds(2026, 12), { startKey: '2026-12-01', endKey: '2027-01-01' })
  assert.equal(getCheckInMonthKey(2026, 8), '2026-08')
  assert.deepEqual(shiftCheckInMonth(2026, 1, -1), { year: 2025, month: 12 })
  assert.deepEqual(shiftCheckInMonth(2026, 12, 1), { year: 2027, month: 1 })
  assert.equal(compareCheckInMonths({ year: 2025, month: 3 }, { year: 2026, month: 1 }) < 0, true)
})

test('月度 API 只返回当前用户指定月份的轻量记录，详情 API 再读取留言', () => {
  assert.match(monthRoute, /getCurrentUser\(\)/)
  assert.match(monthRoute, /where: \{ userId: user\.id, checkinDateKey: \{ gte: startKey, lt: endKey \} \}/)
  assert.match(monthRoute, /select: \{ id: true, checkinDateKey: true, mood: true \}/)
  assert.match(monthRoute, /hasMessage: recordIdsWithMessages\.has\(record\.id\)/)
  assert.match(monthRoute, /earliestYear/)
  assert.match(detailRoute, /message: true/)
  assert.match(detailRoute, /createdAt: true/)
  assert.match(detailRoute, /points: true, exp: true, streakDay: true/)
  assert.match(monthRoute, /Cache-Control.*no-store/)
  assert.match(detailRoute, /Cache-Control.*no-store/)
})

test('挂号记录按钮、年月选择、日期详情和缓存都在弹窗内完成', () => {
  assert.match(surface, /CheckInHistoryDialog initialDate=\{todayValue\}/)
  assert.match(dialog, /挂号记录/)
  assert.match(dialog, /data-checkin-history-dialog/)
  assert.match(dialog, /fetch\(`\/api\/checkin\/history\?year=\$\{year\}&month=\$\{month\}`/)
  assert.match(dialog, /cacheRef = useRef\(new Map/)
  assert.match(dialog, /\/api\/checkin\/history\/\$\{record\.dateKey\}/)
  assert.match(dialog, /<select value=\{view\.year\}/)
  assert.match(dialog, /<select value=\{view\.month\}/)
  assert.match(dialog, /回到本月/)
  assert.match(dialog, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(dialog, /当日没有留下挂号留言/)
  assert.doesNotMatch(dialog, /router\.push|window\.location\.href = `\/checkin/)
})

test('日历状态覆盖心情、今天、未来日期、移动端和深色模式', () => {
  assert.match(dialog, /getMood\(/)
  assert.match(dialog, /record\.dateKey > currentMonth\.dateKey/)
  assert.match(dialog, /is-today/)
  assert.match(dialog, /isFutureMonth/)
  assert.match(css, /\.checkin-history-day-cell\.is-today/)
  assert.match(css, /\.checkin-history-day-cell\.is-future/)
  assert.match(css, /safe-area-inset-top/)
  assert.match(css, /safe-area-inset-bottom/)
  assert.match(css, /\.checkin-history-detail-body[^{]*\{[^}]*overflow:auto/)
  assert.match(css, /\.checkin-history-dialog[^{]*\{[^}]*var\(--surface-elevated\)/)
})

test('挂号记录统一使用直角和正文色，禁用日期继续弱化', () => {
  assert.match(css, /\.checkin-history-dialog[^{]*\{[^}]*border-radius:0/)
  assert.match(css, /\.checkin-history-close[^{]*\{[^}]*border-radius:0/)
  assert.match(css, /\.checkin-history-toolbar>button[^{]*\{[^}]*border-radius:0/)
  assert.match(css, /\.checkin-history-day-cell[^{]*\{[^}]*border-radius:0/)
  assert.match(css, /\.checkin-history-day-number[^{]*\{[^}]*border-radius:0/)
  assert.match(css, /\.checkin-history-weekdays>span,[\s\S]*?color:var\(--foreground\)/)
  assert.match(css, /\.checkin-history-toolbar>span[^{]*\{[^}]*color:var\(--foreground\)/)
  assert.match(css, /\.checkin-history-day-cell\.is-outside-month,[\s\S]*?color:var\(--foreground-muted\)/)
  assert.match(css, /\.checkin-history-day-cell\.is-future[^{]*\{[^}]*color:var\(--foreground-muted\)/)
})
