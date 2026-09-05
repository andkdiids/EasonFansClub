import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { POST as runBirthdayDailyJob } from '../app/api/internal/daily-jobs/birthday/route'

const read = (path: string) => readFileSync(path, 'utf8')

const birthdayLib = read('lib/birthday.ts')
const schema = read('prisma/schema.prisma')
const schemaEnumNotification = schema.slice(schema.indexOf('enum NotificationType'))
const loginRoute = read('app/api/auth/login/route.ts')
const homeData = read('lib/home-data.ts')
const adminPage = read('app/admin/page.tsx')
const dailyJobRoute = read('app/api/internal/daily-jobs/birthday/route.ts')
const notificationsLib = read('lib/notifications.ts')

test('NotificationType enum gains BIRTHDAY_GREETING without adding a table', () => {
  assert.match(schemaEnumNotification, /BIRTHDAY_GREETING/)
  // 不应新增通知表：仅扩展枚举，复用现有 Notification 结构
  assert.doesNotMatch(schema, /model BirthdayGreeting|model BirthdayReward/)
})

test('grantTodayBirthdayRewards scans only today birthday users and grants badge (1: 今日生日可得徽章)', () => {
  assert.match(birthdayLib, /export async function grantTodayBirthdayRewards/)
  // 只查询生日月日 == 今天的用户 => 今日生日用户提供徽章
  assert.match(birthdayLib, /birthMonth:\s*month/)
  assert.match(birthdayLib, /birthDay:\s*day/)
  assert.match(birthdayLib, /await ensureBirthdayBadge\(user\.id, dateKey\)/)
  // 非今日生日用户不会被查询到 => 不会获得（2: 非今日生日不会获得）
  assert.match(birthdayLib, /getBirthdayDateContext\(dateKey\)/)
})

test('grantTodayBirthdayRewards is idempotent and fails safe', () => {
  // 单个用户处理被 try/catch 包裹，整体也被 try/catch 包裹，错误不影响页面
  assert.match(birthdayLib, /try \{\s*await ensureBirthdayBadge\(user\.id, dateKey\)/)
  assert.match(birthdayLib, /console\.error\('\[birthday\.grantRewards\.user\]'/)
  assert.match(birthdayLib, /console\.error\('\[birthday\.grantTodayBirthdayRewards\]'/)
})

test('sendBirthdayGreeting sends at most once per user per year (3: 通知只发一次)', () => {
  assert.match(birthdayLib, /export async function sendBirthdayGreeting/)
  // 逐年去重：key 编码年份
  assert.match(birthdayLib, /birthday-greeting-\$\{year\}/)
  // 发送前查重
  assert.match(birthdayLib, /prisma\.notification\.findFirst/)
  assert.match(birthdayLib, /BIRTHDAY_GREETING/)
  // 复用 Notification 唯一约束 (recipientId, key) 兜底，防止并发重复
  assert.match(schema.slice(schema.indexOf('model Notification')), /@@unique\(\[recipientId, key\]\)/)
})

test('birthday greeting never leaks birthday date or user name (4: 不泄露生日日期)', () => {
  // 标题固定，不含用户名
  assert.match(birthdayLib, /BIRTHDAY_GREETING_TITLE = '🎂 生日纪念'/)
  // 内容为固定字符串，不含模板插值（避免注入日期/姓名）
  assert.match(birthdayLib, /BIRTHDAY_GREETING_CONTENT =\n?\s*'[^`]*'/)
  assert.doesNotMatch(birthdayLib, /BIRTHDAY_GREETING_CONTENT = [`$]/)
  // 创建通知时不写入生日月/日，也不带 actor（不泄露他人身份）
  assert.match(birthdayLib, /actorId:\s*null/)
  // 生日纪念通知跳转到生日祝福卡片页，而非不存在的 /profile/edit（曾导致 404）
  assert.match(birthdayLib, /link:\s*'\/birthday-card'/)
  // 安全修复：发送前必须读取用户生日月/日并校验今天匹配，杜绝登录链路误发
  const greetFn = birthdayLib.slice(
    birthdayLib.indexOf('export async function sendBirthdayGreeting'),
    birthdayLib.indexOf('export async function grantTodayBirthdayRewards'),
  )
  assert.match(greetFn, /prisma\.user\.findUnique/)
  assert.match(greetFn, /user\?\.birthMonth == null \|\| user\?\.birthDay == null/)
  assert.match(greetFn, /user\.birthMonth !== month \|\| user\.birthDay !== day/)
  assert.match(greetFn, /getBirthdayDateContext\(dateKey\)/)
  assert.match(greetFn, /return false/)
})

test('multiple grant calls never duplicate UserBadge (5: 多次调用不重复 UserBadge)', () => {
  assert.match(birthdayLib, /grantKey:\s*`birthday:\$\{dateKey\}`/)
  assert.match(birthdayLib, /ensureBirthdayBadge\(user\.id, dateKey\)/)
  const userBadge = schema.slice(schema.indexOf('model UserBadge'), schema.indexOf('model UserBadgeShowcase'))
  assert.match(userBadge, /grantKey\s+String\?\s+@unique/)
  assert.match(userBadge, /activeKey\s+String\?\s+@unique/)
})

test('login flow keeps an idempotent per-user greeting fallback while the batch stays in the daily job', () => {
  assert.match(loginRoute, /import \{ ensureBirthdayBadge, sendBirthdayGreeting \} from '@\/lib\/birthday'/)
  assert.match(loginRoute, /await sendBirthdayGreeting\(user\.id\)/)
  assert.match(loginRoute, /\.catch\(\(greetingError\) => \{/)
})

test('homepage load only reads birthday stats and never triggers the batch task', () => {
  assert.match(homeData, /import \{ countTodayBirthdays \} from '@\/lib\/birthday'/)
  assert.doesNotMatch(homeData, /grantTodayBirthdayRewards|triggerBirthdayRewardsSweep/)
})

test('birthday greeting gets a friendly label in notification list', () => {
  assert.match(notificationsLib, /BIRTHDAY_GREETING:\s*'生日'/)
})

test('homepage stays read-only and the protected daily endpoint owns the batch task', () => {
  assert.doesNotMatch(homeData, /grantTodayBirthdayRewards|triggerBirthdayRewardsSweep/)
  assert.match(homeData, /countTodayBirthdays/)
  assert.match(dailyJobRoute, /export async function POST\(request: Request\)/)
  assert.doesNotMatch(dailyJobRoute, /export async function GET\(/)
  assert.match(dailyJobRoute, /x-daily-job-secret/)
  assert.match(dailyJobRoute, /status: 503/)
  assert.match(dailyJobRoute, /status: 403/)
  assert.match(dailyJobRoute, /runDailyBirthdayRewards\(dateKey\)/)
  assert.match(dailyJobRoute, /executed: result\.executed/)
  assert.match(dailyJobRoute, /status: result\.status/)
})

test('birthday daily endpoint rejects missing and invalid secrets before touching the database', async () => {
  const previousSecret = process.env.DAILY_JOB_SECRET
  const request = (secret?: string) => new Request('http://127.0.0.1/api/internal/daily-jobs/birthday', {
    method: 'POST',
    headers: secret ? { 'x-daily-job-secret': secret } : undefined,
    body: '{}',
  })

  try {
    process.env.DAILY_JOB_SECRET = 'unit-test-secret'
    assert.equal((await runBirthdayDailyJob(request())).status, 403)
    assert.equal((await runBirthdayDailyJob(request('wrong-secret'))).status, 403)
    delete process.env.DAILY_JOB_SECRET
    assert.equal((await runBirthdayDailyJob(request('unit-test-secret'))).status, 503)
  } finally {
    if (previousSecret === undefined) delete process.env.DAILY_JOB_SECRET
    else process.env.DAILY_JOB_SECRET = previousSecret
  }
})
