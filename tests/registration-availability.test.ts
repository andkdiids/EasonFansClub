import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  formatBeijingDateTimeDisplay,
  parseBeijingDateTime,
  parseRegistrationControlInput,
  resolveRegistrationAvailability,
  serializeRegistrationAvailability,
  serializeRegistrationControlSettings,
  type RegistrationControlSettings,
  validateRegistrationControlSettings,
  validateRegistrationDailySchedule,
} from '../lib/registration-availability'

const opensAt = parseBeijingDateTime('2026-08-11T15:00')
const closesAt = parseBeijingDateTime('2026-08-11T23:59')

assert.ok(opensAt)
assert.ok(closesAt)

function settings(overrides: Partial<RegistrationControlSettings> = {}): RegistrationControlSettings {
  return { mode: 'SCHEDULED', dailySchedule: [], opensAt, closesAt, override: 'NONE', ...overrides }
}

test('北京时间输入按 Asia/Shanghai 解析并保存为 UTC 对应时刻', () => {
  assert.equal(parseBeijingDateTime('2026-08-11T15:00')?.toISOString(), '2026-08-11T07:00:00.000Z')
  assert.equal(formatBeijingDateTimeDisplay('2026-08-11T07:00:00.000Z'), '2026年8月11日 15:00')
  assert.equal(parseBeijingDateTime('2026-02-31T15:00'), null)
})

test('手动模式只根据服务端手动状态开放', () => {
  const availability = resolveRegistrationAvailability({ settings: settings({ mode: 'MANUAL', opensAt: null, closesAt: null }), baseRegistrationOpen: true })
  assert.deepEqual({ status: availability.status, isOpen: availability.isOpen }, { status: 'OPEN', isOpen: true })
})

test('手动模式忽略无关时间字段并且无需时间校验', () => {
  const parsed = parseRegistrationControlInput({
    mode: 'MANUAL',
    opensAt: 'not-a-datetime',
    closesAt: 'also-not-a-datetime',
    dailySchedule: [{ start: 'invalid', end: 'invalid' }],
  })
  assert.ok(parsed)
  assert.equal(parsed.opensAt, null)
  assert.equal(parsed.closesAt, null)
  assert.deepEqual(parsed.dailySchedule, [])
  assert.equal(validateRegistrationControlSettings(parsed), null)
})

test('单次限时模式只校验日期时间且要求结束时间晚于开始时间', () => {
  const missing = parseRegistrationControlInput({ mode: 'ONE_TIME', opensAt: '', closesAt: '', dailySchedule: [{ start: 'invalid', end: 'invalid' }] })
  assert.ok(missing)
  assert.equal(validateRegistrationControlSettings(missing), '请输入正确的开放开始和结束时间，格式 YYYY-MM-DD HH:mm')

  const valid = parseRegistrationControlInput({ mode: 'ONE_TIME', opensAt: '2026-08-13 15:00', closesAt: '2026-08-13 16:00', dailySchedule: [] })
  assert.ok(valid)
  assert.equal(validateRegistrationControlSettings(valid), null)

  const reversed = parseRegistrationControlInput({ mode: 'ONE_TIME', opensAt: '2026-08-13 16:00', closesAt: '2026-08-13 15:00', dailySchedule: [] })
  assert.ok(reversed)
  assert.equal(validateRegistrationControlSettings(reversed), '结束时间必须晚于开始时间')
})

test('每日定时模式只校验每日 HH:mm 时段并忽略日期字段', () => {
  const parsed = parseRegistrationControlInput({
    mode: 'DAILY_SCHEDULE',
    opensAt: 'not-a-datetime',
    closesAt: 'also-not-a-datetime',
    dailySchedule: [{ start: '09:00', end: '23:30' }],
  })
  assert.ok(parsed)
  assert.equal(parsed.opensAt, null)
  assert.equal(parsed.closesAt, null)
  assert.equal(validateRegistrationControlSettings(parsed), null)

  const invalid = parseRegistrationControlInput({ mode: 'DAILY_SCHEDULE', dailySchedule: [{ start: '9:00', end: '23:30' }] })
  assert.equal(invalid, null)
})

test('限时模式在开始前、窗口内、结束后返回对应状态', () => {
  assert.equal(resolveRegistrationAvailability({ settings: settings(), baseRegistrationOpen: true, now: new Date('2026-08-11T06:59:59.999Z') }).status, 'WAITING')
  assert.equal(resolveRegistrationAvailability({ settings: settings(), baseRegistrationOpen: true, now: new Date('2026-08-11T07:00:00.000Z') }).status, 'OPEN')
  assert.equal(resolveRegistrationAvailability({ settings: settings(), baseRegistrationOpen: true, now: new Date('2026-08-11T15:59:00.000Z') }).status, 'ENDED')
})

test('服务端立即关闭覆盖优先于时间窗口，立即开放覆盖可提前开放', () => {
  assert.equal(resolveRegistrationAvailability({ settings: settings({ override: 'CLOSED' }), baseRegistrationOpen: true, now: new Date('2026-08-11T07:30:00.000Z') }).status, 'CLOSED')
  assert.equal(resolveRegistrationAvailability({ settings: settings({ override: 'OPEN' }), baseRegistrationOpen: true, now: new Date('2026-08-11T06:00:00.000Z') }).status, 'OPEN')
  assert.equal(resolveRegistrationAvailability({ settings: settings({ override: 'OPEN' }), baseRegistrationOpen: true, now: new Date('2026-08-11T15:59:00.000Z') }).status, 'ENDED')
})

test('环境或现有注册方式关闭时统一返回 CLOSED', () => {
  const availability = resolveRegistrationAvailability({ settings: settings(), baseRegistrationOpen: false, now: new Date('2026-08-11T07:30:00.000Z') })
  assert.equal(availability.status, 'CLOSED')
  assert.equal(serializeRegistrationAvailability(availability).timezone, 'Asia/Shanghai')
})

function dailySettings(dailySchedule: RegistrationControlSettings['dailySchedule']): RegistrationControlSettings {
  return { mode: 'DAILY_SCHEDULE', dailySchedule, opensAt: null, closesAt: null, override: 'NONE' }
}

function beijingTime(time: string, date = '2026-08-12') {
  const value = parseBeijingDateTime(`${date}T${time}`)
  assert.ok(value)
  return value
}

test('每日定时模式按北京时间处理开放边界和下一次状态变化', () => {
  const settings = dailySettings([{ start: '15:00', end: '23:50' }])
  assert.equal(resolveRegistrationAvailability({ settings, baseRegistrationOpen: true, now: beijingTime('14:59') }).status, 'WAITING')
  assert.equal(resolveRegistrationAvailability({ settings, baseRegistrationOpen: true, now: beijingTime('15:00') }).status, 'OPEN')
  assert.equal(resolveRegistrationAvailability({ settings, baseRegistrationOpen: true, now: beijingTime('23:49') }).status, 'OPEN')
  const closed = resolveRegistrationAvailability({ settings, baseRegistrationOpen: true, now: beijingTime('23:50') })
  assert.equal(closed.status, 'WAITING')
  assert.equal(closed.nextChangeType, 'OPEN')
  assert.equal(closed.nextChangeAt?.toISOString(), '2026-08-13T07:00:00.000Z')
})

test('每日定时模式正确处理跨午夜时段', () => {
  const settings = dailySettings([{ start: '22:00', end: '02:00' }])
  assert.equal(resolveRegistrationAvailability({ settings, baseRegistrationOpen: true, now: beijingTime('21:59') }).isOpen, false)
  assert.equal(resolveRegistrationAvailability({ settings, baseRegistrationOpen: true, now: beijingTime('22:00') }).isOpen, true)
  assert.equal(resolveRegistrationAvailability({ settings, baseRegistrationOpen: true, now: beijingTime('23:59') }).isOpen, true)
  assert.equal(resolveRegistrationAvailability({ settings, baseRegistrationOpen: true, now: beijingTime('00:30', '2026-08-13') }).isOpen, true)
  assert.equal(resolveRegistrationAvailability({ settings, baseRegistrationOpen: true, now: beijingTime('01:59', '2026-08-13') }).isOpen, true)
  const closed = resolveRegistrationAvailability({ settings, baseRegistrationOpen: true, now: beijingTime('02:00', '2026-08-13') })
  assert.equal(closed.isOpen, false)
  assert.equal(closed.nextChangeType, 'OPEN')
})

test('每日定时模式支持多个不重叠时段，并拒绝重叠但允许相邻', () => {
  const settings = dailySettings([
    { start: '10:00', end: '12:00' },
    { start: '15:00', end: '18:00' },
    { start: '20:00', end: '23:00' },
  ])
  assert.equal(resolveRegistrationAvailability({ settings, baseRegistrationOpen: true, now: beijingTime('11:00') }).isOpen, true)
  assert.equal(resolveRegistrationAvailability({ settings, baseRegistrationOpen: true, now: beijingTime('13:00') }).isOpen, false)
  assert.equal(resolveRegistrationAvailability({ settings, baseRegistrationOpen: true, now: beijingTime('20:30') }).isOpen, true)
  assert.equal(validateRegistrationDailySchedule([{ start: '10:00', end: '12:00' }, { start: '12:00', end: '15:00' }]), null)
  assert.match(String(validateRegistrationDailySchedule([{ start: '15:00', end: '18:00' }, { start: '17:00', end: '20:00' }])), /重叠/)
  assert.match(String(validateRegistrationDailySchedule([{ start: '22:00', end: '02:00' }, { start: '01:00', end: '03:00' }])), /重叠/)
})

test('旧 SCHEDULED 配置兼容为 ONE_TIME，不改变一次性时间窗口', () => {
  const availability = resolveRegistrationAvailability({ settings: settings(), baseRegistrationOpen: true, now: new Date('2026-08-11T07:30:00.000Z') })
  assert.equal(availability.mode, 'ONE_TIME')
  assert.equal(serializeRegistrationControlSettings(settings()).mode, 'ONE_TIME')
  assert.deepEqual(serializeRegistrationAvailability(availability).dailySchedule, [])
})

test('注册推进接口都经过统一服务端状态门禁且状态接口禁止缓存', () => {
  const guardedFiles = [
    'app/api/auth/register/prepare/route.ts',
    'app/api/auth/register/send-email-code/route.ts',
    'app/api/auth/register/verify-code/route.ts',
    'app/api/auth/register/route.ts',
    'app/api/auth/register/status/route.ts',
    'app/api/auth/hospital-check/route.ts',
    'app/api/auth/hospital-check/answer/route.ts',
  ]
  for (const path of guardedFiles) {
    const source = readFileSync(path, 'utf8')
    assert.match(source, /getRegistrationAvailabilityError/)
    assert.match(source, /getRegistrationPolicy/)
  }
  const statusRoute = readFileSync('app/api/auth/register/status/route.ts', 'utf8')
  const adminControlRoute = readFileSync('app/api/admin/security-settings/route.ts', 'utf8')
  assert.match(readFileSync('lib/registration.ts', 'utf8'), /export async function getRegistrationAvailability/)
  assert.match(adminControlRoute, /validateRegistrationControlSettings/)
  assert.match(adminControlRoute, /parsed\.mode === 'ONE_TIME'/)
  assert.match(statusRoute, /export async function GET\(\)/)
  assert.match(statusRoute, /Cache-Control.*no-store/)
  assert.match(readFileSync('app/register/page.tsx', 'utf8'), /force-dynamic/)
  assert.match(readFileSync('app/register/RegisterForm.tsx', 'utf8'), /30_000/)
})
