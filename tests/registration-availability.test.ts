import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  formatBeijingDateTimeDisplay,
  parseBeijingDateTime,
  resolveRegistrationAvailability,
  serializeRegistrationAvailability,
  type RegistrationControlSettings,
} from '../lib/registration-availability'

const opensAt = parseBeijingDateTime('2026-08-11T15:00')
const closesAt = parseBeijingDateTime('2026-08-11T23:59')

assert.ok(opensAt)
assert.ok(closesAt)

function settings(overrides: Partial<RegistrationControlSettings> = {}): RegistrationControlSettings {
  return { mode: 'SCHEDULED', opensAt, closesAt, override: 'NONE', ...overrides }
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
  assert.match(readFileSync('lib/registration.ts', 'utf8'), /export async function getRegistrationAvailability/)
  assert.match(statusRoute, /export async function GET\(\)/)
  assert.match(statusRoute, /Cache-Control.*no-store/)
  assert.match(readFileSync('app/register/page.tsx', 'utf8'), /force-dynamic/)
  assert.match(readFileSync('app/register/RegisterForm.tsx', 'utf8'), /30_000/)
})
