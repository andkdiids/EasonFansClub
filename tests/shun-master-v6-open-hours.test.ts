import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  SHUN_CLOSED_TITLE, SHUN_OPEN_HOURS_DEFAULT, beijingMinuteOfDay, formatShunClock, formatShunClockShort,
  isShunOpen, nextShunOpenAt, parseShunClock, shunClosedMessage, shunOpenHoursError, shunOpenHoursHelp,
  shunOpenHoursHint, shunOpenHoursLabel, shunOpenHoursLine, shunOpenHoursState, type ShunOpenHoursConfig,
} from '../lib/shun-open-hours'
import { defaultShunConfig, shunConfigError, validateShunConfig } from '../lib/shun-config'

/**
 * V6 — daily opening hours.
 *
 * Every instant below is written as UTC and asserted in Beijing time, so the
 * boundary checks do not depend on the machine's timezone or the real clock.
 * The source-contract tests at the bottom pin the wiring that cannot be observed
 * from the pure helpers: the settlement gate, the rejection payload, the
 * admin surface and the page copy.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const window = (openTime: string, closeTime: string, openHoursEnabled = true): ShunOpenHoursConfig =>
  ({ openHoursEnabled, openTime, closeTime })

/** Beijing wall clock → the equivalent UTC instant. */
const beijing = (iso: string) => new Date(iso.replace(' ', 'T') + '+08:00')

test('默认开放时间开启且为 09:00–23:00', () => {
  assert.deepEqual(SHUN_OPEN_HOURS_DEFAULT, { openHoursEnabled: true, openTime: '09:00', closeTime: '23:00' })
  const config = validateShunConfig(defaultShunConfig)
  assert.equal(config?.openHoursEnabled, true)
  assert.equal(config?.openTime, '09:00')
  assert.equal(config?.closeTime, '23:00')
  assert.equal(shunOpenHoursLabel(config!), '09:00–23:00')
})

test('北京时间边界：08:59:59 关闭、09:00:00 开放、22:59:59 开放、23:00:00 关闭、次日 09:00 恢复', () => {
  const open = window('09:00', '23:00')
  assert.equal(isShunOpen(open, beijing('2026-11-26 08:59:59')), false)
  assert.equal(isShunOpen(open, beijing('2026-11-26 09:00:00')), true)
  assert.equal(isShunOpen(open, beijing('2026-11-26 22:59:59')), true)
  assert.equal(isShunOpen(open, beijing('2026-11-26 23:00:00')), false)
  assert.equal(isShunOpen(open, beijing('2026-11-27 09:00:00')), true)
  // Microseconds after the closing instant are still closed.
  assert.equal(isShunOpen(open, new Date(beijing('2026-11-26 23:00:00').getTime() + 1)), false)
  // ...and the same holds one minute before closing.
  assert.equal(isShunOpen(open, new Date(beijing('2026-11-26 23:00:00').getTime() - 1)), true)
})

test('北京时间换算不受服务器时区影响', () => {
  assert.equal(beijingMinuteOfDay(new Date('2026-11-26T00:59:59Z')), 8 * 60 + 59)
  assert.equal(beijingMinuteOfDay(new Date('2026-11-26T01:00:00Z')), 9 * 60)
  assert.equal(beijingMinuteOfDay(new Date('2026-11-26T15:00:00Z')), 23 * 60)
  // Wraps to the next Beijing day at 16:00Z.
  assert.equal(beijingMinuteOfDay(new Date('2026-11-26T16:00:00Z')), 0)
  assert.equal(formatShunClock(540), '09:00')
  assert.equal(formatShunClockShort(540), '9:00')
  assert.equal(formatShunClockShort(600), '10:00')
  assert.equal(parseShunClock('09:00'), 540)
  assert.equal(parseShunClock('23:00'), 1380)
  for (const invalid of ['9:00', '24:00', '09:60', '0900', '', '  ']) assert.equal(parseShunClock(invalid), null, invalid)
})

test('跨午夜时段按北京时间正确判断', () => {
  const overnight = window('22:00', '02:00')
  assert.equal(isShunOpen(overnight, beijing('2026-11-26 21:59:59')), false)
  assert.equal(isShunOpen(overnight, beijing('2026-11-26 22:00:00')), true)
  assert.equal(isShunOpen(overnight, beijing('2026-11-26 23:30:00')), true)
  assert.equal(isShunOpen(overnight, beijing('2026-11-27 01:59:59')), true)
  assert.equal(isShunOpen(overnight, beijing('2026-11-27 02:00:00')), false)
  assert.equal(isShunOpen(overnight, beijing('2026-11-27 12:00:00')), false)
  // The next opening after the small hours is the same Beijing evening.
  assert.equal(nextShunOpenAt(overnight, beijing('2026-11-27 03:00:00'))?.toISOString(),
    beijing('2026-11-27 22:00:00').toISOString())
})

test('下一次开放时间按北京时间次日计算', () => {
  const open = window('09:00', '23:00')
  assert.equal(nextShunOpenAt(open, beijing('2026-11-26 23:00:00'))?.toISOString(),
    beijing('2026-11-27 09:00:00').toISOString())
  assert.equal(nextShunOpenAt(open, beijing('2026-11-26 08:00:00'))?.toISOString(),
    beijing('2026-11-26 09:00:00').toISOString())
  // Already open: no next opening to report.
  assert.equal(nextShunOpenAt(open, beijing('2026-11-26 12:00:00')), null)
  // A disabled restriction is open around the clock.
  const disabled = window('09:00', '23:00', false)
  assert.equal(isShunOpen(disabled, beijing('2026-11-26 03:00:00')), true)
  assert.equal(nextShunOpenAt(disabled, beijing('2026-11-26 03:00:00')), null)
})

test('休息态文案随配置变化，后台改时间后无需改前端', () => {
  assert.equal(shunOpenHoursHint(window('09:00', '23:00')), '请在早上 9:00 后再来！')
  assert.equal(shunOpenHoursLine(window('09:00', '23:00')), '每日开放时间：09:00–23:00')
  // The published example: 10:00–22:00 must read 「请在早上 10:00 后再来！」
  assert.equal(shunOpenHoursHint(window('10:00', '22:00')), '请在早上 10:00 后再来！')
  assert.equal(shunOpenHoursLine(window('10:00', '22:00')), '每日开放时间：10:00–22:00')
  assert.equal(shunOpenHoursLabel(window('10:00', '22:00')), '10:00–22:00')
  // Cross-midnight and afternoon openings read naturally instead of "早上 22:00".
  assert.equal(shunOpenHoursHint(window('22:00', '02:00')), '请在晚上 22:00 后再来！')
  assert.equal(shunOpenHoursHint(window('14:00', '20:00')), '请在下午 14:00 后再来！')
  assert.match(shunClosedMessage(window('10:00', '22:00')), /顺大师已加入早睡联盟，正在休息中，请在早上 10:00 后再来！/)
  assert.match(SHUN_CLOSED_TITLE, /早睡联盟/)
})

test('玩法说明同步：开放时说明区间，关闭限制时说明全天开放', () => {
  assert.equal(shunOpenHoursHelp(window('09:00', '23:00')),
    '顺大师每日开放时间为 09:00–23:00（北京时间），非开放时间无法发起新的顺取，但仍可查看记录及进行抓捕调查。')
  assert.equal(shunOpenHoursHelp(window('10:00', '22:00')),
    '顺大师每日开放时间为 10:00–22:00（北京时间），非开放时间无法发起新的顺取，但仍可查看记录及进行抓捕调查。')
  assert.equal(shunOpenHoursHelp(window('09:00', '23:00', false)),
    '顺大师当前全天开放，仍需遵守每日次数及其他玩法限制。')
})

test('配置校验：格式、相同起止时间与旧配置回填', () => {
  assert.equal(shunOpenHoursError(window('09:00', '23:00')), null)
  assert.equal(shunOpenHoursError(window('22:00', '02:00')), null)
  assert.equal(shunOpenHoursError(window('00:00', '23:59')), null)
  assert.match(shunOpenHoursError(window('9:00', '23:00')) ?? '', /HH:MM/)
  assert.match(shunOpenHoursError(window('09:00', '24:00')) ?? '', /HH:MM/)
  assert.match(shunOpenHoursError(window('09:00', '09:00')) ?? '', /不能相同/)
  assert.match(shunOpenHoursError({ openHoursEnabled: 'yes', openTime: '09:00', closeTime: '23:00' }) ?? '', /开关/)
  // Absent fields are a legacy row, not an error: defaults are applied instead.
  assert.equal(shunOpenHoursError({ enabled: true }), null)
  const legacy = { enabled: true, attempts: 7, victimCap: 4, goldenMinutes: 10,
    probabilities: [25, 21, 17, 14, 10, 7, 6], weights: [130, 122, 115, 108, 100] }
  assert.equal(shunConfigError(legacy), null)
  assert.deepEqual(
    (({ openHoursEnabled, openTime, closeTime }) => ({ openHoursEnabled, openTime, closeTime }))(
      validateShunConfig(legacy)!),
    { openHoursEnabled: true, openTime: '09:00', closeTime: '23:00' })
  // The whole-config validator rejects the ambiguous window as well.
  assert.match(shunConfigError({ ...defaultShunConfig, openTime: '09:00', closeTime: '09:00' }) ?? '', /不能相同/)
  assert.match(shunConfigError({ ...defaultShunConfig, openTime: '25:00' }) ?? '', /HH:MM/)
})

test('服务端快照同时给出区间、当前状态与下一次开放时间', () => {
  const state = shunOpenHoursState(window('09:00', '23:00'), beijing('2026-11-26 23:30:00'))
  assert.deepEqual(state, {
    openHoursEnabled: true, openTime: '09:00', closeTime: '23:00', label: '09:00–23:00',
    open: false, nextOpenAt: beijing('2026-11-27 09:00:00').toISOString(),
  })
  const openState = shunOpenHoursState(window('09:00', '23:00'), beijing('2026-11-26 12:00:00'))
  assert.equal(openState.open, true)
  assert.equal(openState.nextOpenAt, null)
})

test('服务端在顺取结算事务内做权威时间校验，拒绝时不产生任何副作用', () => {
  const service = read('lib/shun-master.ts')
  // The gate lives in the settlement transaction, right after the enabled check
  // and before every balance/target/round operation.
  const transactionStart = service.indexOf('const result = await shunTransaction(async (tx) => {')
  const gate = service.indexOf("throw new ShunError('SHUN_CLOSED'")
  const firstRoundWrite = service.indexOf('tx.shunMasterRound.create')
  assert.ok(transactionStart > 0 && gate > transactionStart, '开放时间校验必须在结算事务内')
  assert.ok(firstRoundWrite > gate, '开放时间校验必须早于任何对局写入')
  // Authoritative clock is read inside the transaction, not only before it.
  assert.match(service, /const settledAt = clock\(\)/)
  assert.match(service, /const openHours = shunOpenHoursState\(config, settledAt\)/)
  assert.match(service, /if \(!openHours\.open\) \{/)
  assert.match(service, /shunClosedMessage\(config\)/)
  // The rejection carries the live window and the next opening instant.
  assert.match(service, /\{ openHours \}\)/)
  // The status snapshot the page renders comes from the same configuration row.
  assert.match(service, /openHours: shunOpenHoursState\(config, serverNow\)/)
  // Historical rights: the capture, letter and notification paths stay outside
  // the window entirely.
  for (const fn of ['shunCapture', 'shunSendNotification', 'shunSendCaptureNotification', 'shunRecords']) {
    const declaration = new RegExp(`export (?:async )?function ${fn}\\(`).exec(service)
    assert.ok(declaration, fn + ' 必须存在')
    // Body runs to the next top-level export.
    const rest = service.slice(declaration.index + 1)
    const end = rest.search(/\nexport (?:async )?function |\nexport \{/)
    const body = end < 0 ? rest : rest.slice(0, end)
    assert.doesNotMatch(body, /isShunOpen|SHUN_CLOSED|shunOpenHoursState/, fn + ' 不得受开放时间限制')
  }
  // Replaying a settled request stays idempotent even after closing time: the
  // replay check runs before the window gate.
  assert.ok(service.indexOf('if (previous) return present(tx, previous, \'out\')') < gate,
    '已完成请求的重放必须先于开放时间校验')
})

test('拒绝响应携带开放时间详情，且只允许管理员修改配置', () => {
  const route = read('app/api/shun-master/[action]/route.ts')
  assert.match(route, /\.\.\.\(error\.details \? \{ details: error\.details \} : \{\}\)/)
  // Players may only attempt or opt out through this route.
  assert.match(route, /action !== 'attempt' && action !== 'opt-out'/)
  const admin = read('app/api/admin/shun-master/route.ts')
  assert.match(admin, /requireAdmin\('site_config_manage'\)/)
  assert.match(admin, /openHoursNow: shunOpenHoursState\(config, requestedAt\)/)
})

test('后台提供开关、开始与结束时间选择器、时区说明与独立保存', () => {
  const admin = read('app/admin/shun-master/ShunMasterAdmin.tsx')
  assert.match(admin, /每日开放时间/)
  assert.match(admin, /启用开放时间限制/)
  assert.match(admin, /type="time"/)
  assert.match(admin, /每日开放开始时间/)
  assert.match(admin, /每日开放结束时间/)
  assert.match(admin, /时区：北京时间（UTC\+8）/)
  assert.match(admin, /开启后，用户只能在设定时间内发起新的顺取。历史记录、抓捕调查及已有留言不受限制。/)
  assert.match(admin, /保存开放时间/)
  assert.match(admin, /openHoursEnabled/)
})

test('前台按服务端配置渲染休息态，且不写死时间', () => {
  const page = read('app/shun-master/ShunMasterClient.tsx')
  assert.match(page, /SHUN_CLOSED_TITLE/)
  assert.match(page, /shunOpenHoursHint\(openHours\)/)
  assert.match(page, /shunOpenHoursLine\(openHours\)/)
  assert.match(page, /shunOpenHoursHelp\(openHours\)/)
  assert.match(page, /休息中 💤/)
  assert.match(page, /isShunOpen\(openHours, new Date\(/)
  // Nothing about the window may be baked into the page.
  assert.doesNotMatch(page, /09:00|23:00/, '前台不得写死默认开放时间')
  // The closed state re-syncs on its own and when the page becomes visible again.
  assert.match(page, /void loadStatus\(\)\r?\n  \}, \[openHours, openNow, loadStatus\]\)/)
  assert.match(page, /addEventListener\('visibilitychange', resync\)/)
  assert.match(page, /addEventListener\('focus', resync\)/)
  // A server-side rejection refreshes the snapshot instead of leaving a stale button.
  assert.match(page, /error\.code === 'SHUN_CLOSED'\) void loadStatus\(\)/)
})
