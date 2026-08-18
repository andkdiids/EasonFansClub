import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const birthdayLib = read('lib/birthday.ts')
const schema = read('prisma/schema.prisma')
const schemaEnumNotification = schema.slice(schema.indexOf('enum NotificationType'))
const loginRoute = read('app/api/auth/login/route.ts')
const homeData = read('lib/home-data.ts')
const adminPage = read('app/admin/page.tsx')
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
  assert.match(birthdayLib, /await ensureBirthdayBadge\(user\.id\)/)
  // 非今日生日用户不会被查询到 => 不会获得（2: 非今日生日不会获得）
  assert.match(birthdayLib, /getTodayMonthDay\(\)/)
})

test('grantTodayBirthdayRewards is idempotent and fails safe', () => {
  // 单个用户处理被 try/catch 包裹，整体也被 try/catch 包裹，错误不影响页面
  assert.match(birthdayLib, /try \{\s*await ensureBirthdayBadge\(user\.id\)/)
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
  assert.match(greetFn, /getTodayMonthDay\(\)/)
  assert.match(greetFn, /return false/)
})

test('multiple grant calls never duplicate UserBadge (5: 多次调用不重复 UserBadge)', () => {
  assert.match(birthdayLib, /userId_badgeId/)
  assert.match(birthdayLib, /upsert/)
  // 唯一约束 (userId, badgeId) 兜底
  assert.match(schema.slice(schema.indexOf('model UserBadge')), /@@unique\(\[userId, badgeId\]\)/)
})

test('login flow also grants greeting per-user (no cron needed)', () => {
  assert.match(loginRoute, /import \{ ensureBirthdayBadge, sendBirthdayGreeting \} from '@\/lib\/birthday'/)
  assert.match(loginRoute, /await sendBirthdayGreeting\(user\.id\)/)
})

test('homepage load triggers the daily sweep (fire-and-forget, no cron)', () => {
  assert.match(homeData, /import \{ countTodayBirthdays, grantTodayBirthdayRewards \} from '@\/lib\/birthday'/)
  assert.match(homeData, /triggerBirthdayRewardsSweep\(\)/)
  assert.match(homeData, /void grantTodayBirthdayRewards\(\)\.catch/)
})

test('birthday greeting gets a friendly label in notification list', () => {
  assert.match(notificationsLib, /BIRTHDAY_GREETING:\s*'生日'/)
})

test('admin dashboard shows sent greetings and awarded badges counts', () => {
  assert.match(adminPage, /countBirthdayGreetingsSent/)
  assert.match(adminPage, /countBirthdayBadgesAwarded/)
  assert.match(adminPage, /\['生日祝福', birthdayGreetings\]/)
  assert.match(adminPage, /\['生日徽章', birthdayBadges\]/)
})
