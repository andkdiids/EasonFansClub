import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('schema stores birthday month/day only (no birth year) with an index', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /birthMonth\s+Int\?/)
  assert.match(schema, /birthDay\s+Int\?/)
  assert.match(schema, /birthdaySetAt\s+DateTime\?/)
  assert.match(schema, /@@index\(\[birthMonth, birthDay\]\)/)
  // 不应保存完整出生日期或年份字段
  assert.doesNotMatch(schema, /birthYear|birthDate|Date\s+@default|\bbirthYear\b/)
})

test('seed inserts the birthday-commemorative badge with auto-grant', () => {
  const seed = read('prisma/seed.ts')
  assert.match(seed, /slug:\s*'birthday-commemorative'/)
  assert.match(seed, /name:\s*'生日纪念'/)
  assert.match(seed, /isAutoGrant:\s*true/)
})

test('birthday service exports count + idempotent grant helpers', () => {
  const lib = read('lib/birthday.ts')
  assert.match(lib, /export async function countTodayBirthdays/)
  assert.match(lib, /export async function ensureBirthdayBadge/)
  assert.match(lib, /BIRTHDAY_BADGE_SLUG = 'birthday-commemorative'/)
  // 授予依赖唯一约束，保证只授一次、永久保留
  assert.match(lib, /userId_badgeId/)
})

test('homepage birthday count uses real user month/day, not TodayEvent', () => {
  const home = read('lib/home-data.ts')
  assert.match(home, /import \{ countTodayBirthdays.*\} from '@\/lib\/birthday'/)
  assert.match(home, /safeDb\('User.count home.siteStats.birthdays', countTodayBirthdays\(dateKey\)/)
  assert.doesNotMatch(home, /grantTodayBirthdayRewards|triggerBirthdayRewardsSweep/)
  assert.doesNotMatch(home, /type:\s*'BIRTHDAY', status:\s*'APPROVED'/)
})

test('profile API exposes birthday and enforces one-time immutable writes without revoking history', () => {
  const route = read('app/api/users/me/route.ts')
  assert.match(route, /birthMonth:\s*true/)
  assert.match(route, /birthDay:\s*true/)
  assert.match(route, /birthdaySetAt:\s*true/)
  // 首次设置使用条件 updateMany；已经设置的生日只能同值 no-op，不能修改或清空。
  assert.match(route, /writeBirthdayOnce\(tx, guard\.user\.id/)
  assert.match(read('lib/birthday-immutability.ts'), /birthMonth:\s*null/)
  assert.match(read('lib/birthday-immutability.ts'), /birthDay:\s*null/)
  assert.match(read('lib/birthday-immutability.ts'), /BIRTHDAY_ALREADY_SET/)
  assert.match(route, /isValidBirthdayParts/)
  assert.doesNotMatch(route, /data\.birthMonth\s*=/)
  assert.doesNotMatch(route, /data\.birthDay\s*=/)
  assert.match(route, /USER_BIRTHDAY_UPDATED/)
})

test('profile form shows one-time setup and read-only state after the initial set', () => {
  const form = read('app/profile/ProfileSettingsForm.tsx')
  assert.match(form, /当前生日/)
  assert.match(form, /请选择月份/)
  assert.match(form, /请选择日期/)
  assert.match(form, /生日仅可设置一次，保存后不可修改，请确认日期无误。/)
  assert.match(form, /<h2 id="birthday-confirm-title"[^>]*>确认生日<\/h2>/)
  assert.match(form, /确认并保存/)
  assert.match(form, /isBirthdayConfigured\(persistedBirthday\)/)
  assert.doesNotMatch(form, /可随时修正/)
  assert.doesNotMatch(form, /修改生日后只会影响之后的生日判断/)
})

test('birthday badge is auto-granted on login and on visiting own profile', () => {
  const login = read('app/api/auth/login/route.ts')
  const profile = read('app/profile/page.tsx')
  assert.match(login, /ensureBirthdayBadge\(user\.id\)/)
  assert.match(profile, /await ensureBirthdayBadge\(user\.id\)/)
})

test('admin can see today birthday count and a privacy-safe list page', () => {
  const admin = read('lib/admin-navigation.ts')
  const list = read('app/admin/birthdays/page.tsx')
  const dailyJob = read('app/api/internal/daily-jobs/birthday/route.ts')
  const execution = read('lib/daily-job-execution.ts')
  assert.match(admin, /href: '\/admin\/birthdays'/)
  assert.match(admin, /title: '生日管理'/)
  assert.doesNotMatch(admin, /countTodayBirthdays\(\)/)
  assert.match(list, /requireAdminPage\('\/admin\/birthdays',/)
  assert.match(list, /birthMonth: month/)
  assert.match(list, /birthDay: day/)
  // 列表只展示 UID / 昵称 / 注册时间，渲染层不输出生日日期或头像
  assert.match(list, /formatUid\(item\.uid\)/)
  assert.doesNotMatch(list, /item\.birthMonth|item\.birthDay|item\.avatarUrl|<img/)
  assert.match(dailyJob, /runDailyBirthdayRewards\(dateKey\)/)
  assert.match(execution, /status: 'RUNNING'/)
  assert.match(execution, /status: 'SUCCEEDED'/)
  assert.match(execution, /status: 'FAILED'/)
  assert.match(execution, /where: \{ jobKey, dateKey, runToken \}/)
  assert.match(execution, /already_completed/)
  assert.match(execution, /already_running/)
  assert.match(execution, /randomUUID\(\)/)
})

test('public user modules never expose birthday fields (privacy boundary)', () => {
  const pub = read('app/api/users/[userId]/public-modules/route.ts')
  // 公开接口（含 badges 模块）不得 select 生日月/日
  assert.doesNotMatch(pub, /birthMonth|birthDay|birthdaySetAt/)
})
