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
  assert.match(home, /safeDb\('TodayEvent.count home.siteStats.birthdays', countTodayBirthdays\(\)/)
  assert.doesNotMatch(home, /type:\s*'BIRTHDAY', status:\s*'APPROVED'/)
})

test('profile API exposes birthday to self and enforces one-time, immutable set', () => {
  const route = read('app/api/users/me/route.ts')
  assert.match(route, /birthMonth:\s*true/)
  assert.match(route, /birthDay:\s*true/)
  assert.match(route, /birthdaySetAt:\s*true/)
  // 一次性写入逻辑：已设置则忽略，未设置才接受首次填写
  assert.match(route, /const birthdayAlreadySet = Boolean\(current\?\.birthdaySetAt\)/)
  assert.match(route, /data\.birthdaySetAt = now/)
  // 日期合法性校验（含闰年 2 月 29 日）
  assert.match(route, /new Date\(2020, birthMonthRaw - 1, birthDayRaw\)/)
})

test('profile form has month/day picker and locked-after-set UI', () => {
  const form = read('app/profile/ProfileSettingsForm.tsx')
  assert.match(form, /生日已设置/)
  assert.match(form, /请选择月份/)
  assert.match(form, /请选择日期/)
  // 已设置时不提交生日，避免被服务端忽略之外的前端误传
  assert.match(form, /form\.birthdaySetAt\s*\?\s*\{\}\s*:\s*\{ birthMonth/)
})

test('birthday badge is auto-granted on login and on visiting own profile', () => {
  const login = read('app/api/auth/login/route.ts')
  const profile = read('app/profile/page.tsx')
  assert.match(login, /ensureBirthdayBadge\(user\.id\)/)
  assert.match(profile, /await ensureBirthdayBadge\(user\.id\)/)
})

test('admin can see today birthday count and a privacy-safe list page', () => {
  const admin = read('app/admin/page.tsx')
  const list = read('app/admin/birthdays/page.tsx')
  assert.match(admin, /countTodayBirthdays\(\)/)
  assert.match(admin, /\['今日生日', todayBirthdays\]/)
  assert.match(list, /requireAdminPage\('\/admin\/birthdays'\)/)
  // 列表只展示 UID / 昵称 / 注册时间，渲染层不输出生日日期或头像
  assert.match(list, /formatUid\(item\.uid\)/)
  assert.doesNotMatch(list, /item\.birthMonth|item\.birthDay|item\.avatarUrl|<img/)
})

test('public user modules never expose birthday fields (privacy boundary)', () => {
  const pub = read('app/api/users/[userId]/public-modules/route.ts')
  // 公开接口（含 badges 模块）不得 select 生日月/日
  assert.doesNotMatch(pub, /birthMonth|birthDay|birthdaySetAt/)
})
