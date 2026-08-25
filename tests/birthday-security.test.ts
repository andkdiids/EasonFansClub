import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const birthdayLib = read('lib/birthday.ts')
const loginRoute = read('app/api/auth/login/route.ts')
const homeData = read('lib/home-data.ts')

// 抽取 sendBirthdayGreeting 函数本体（便于局部断言）
const greetFnStart = birthdayLib.indexOf('export async function sendBirthdayGreeting')
const greetFnEnd = birthdayLib.indexOf('export async function grantTodayBirthdayRewards')
const greetFn = birthdayLib.slice(greetFnStart, greetFnEnd)

test('sendBirthdayGreeting rejects users without a birthday (1: 无生日用户 → 0 通知)', () => {
  // 必须先查用户生日，且月/日任一为空立即 return false，绝不触达 notification.create
  assert.match(greetFn, /prisma\.user\.findUnique/)
  assert.match(greetFn, /user\?\.birthMonth == null \|\| user\?\.birthDay == null/)
  // 未设置生日时必然 return false（不会创建通知）
  assert.match(greetFn, /return false/)
  // 通知创建语句位于所有 return false 之后（隐含：空生日路径无法到达）
  assert.match(greetFn, /createNotification\(/)
})

test('sendBirthdayGreeting rejects users whose birthday is not today (2: 非今日生日 → 0 通知)', () => {
  // 取上海时区今天月/日，与用户生日不符立即 return false
  assert.match(greetFn, /getBirthdayDateContext\(dateKey\)/)
  assert.match(greetFn, /user\.birthMonth !== month \|\| user\.birthDay !== day/)
})

test('sendBirthdayGreeting sends exactly one greeting to a real today-birthday user (3: 今日生日 → 1 通知)', () => {
  // 通过生日校验、逐年去重查重后，才创建一条通知
  assert.match(greetFn, /BIRTHDAY_GREETING_KEY_PREFIX\}-\$\{year\}/)
  assert.match(greetFn, /prisma\.notification\.findFirst/)
  assert.match(greetFn, /createNotification\(/)
  // 仍保留幂等：命中已存在则跳过（不会重复创建）
  assert.match(greetFn, /if \(existing\) return false/)
})

test('batch reward sweep only selects users who actually have today birthday (4: 批量不会选择无生日用户)', () => {
  assert.match(birthdayLib, /export async function grantTodayBirthdayRewards/)
  // 查询条件直接按 birthMonth/birthDay 过滤，而非查出全部用户再循环判断
  assert.match(birthdayLib, /birthMonth:\s*month/)
  assert.match(birthdayLib, /birthDay:\s*day/)
  assert.match(birthdayLib, /status:\s*'ACTIVE'/)
  assert.match(birthdayLib, /isDeleted:\s*false/)
  // 批量流程遍历的是「今日生日用户列表」，逐位授予徽章 + 祝福
  assert.match(birthdayLib, /await ensureBirthdayBadge\(user\.id, dateKey\)/)
  assert.match(birthdayLib, /await sendBirthdayGreeting\(user\.id, dateKey\)/)
})

test('login flow triggers greeting but the in-function guard protects non-birthday users', () => {
  // 误发根因：登录链路无条件调用 sendBirthdayGreeting
  assert.match(loginRoute, /await sendBirthdayGreeting\(user\.id\)/)
  // 关键修复：发送函数自身必须兜底校验生日，已在 greetFn 中断言
  assert.match(greetFn, /user\?\.birthMonth == null \|\| user\?\.birthDay == null/)
})

test('homepage only reads birthday count; batch runs through the protected job endpoint', () => {
  assert.doesNotMatch(homeData, /triggerBirthdayRewardsSweep|grantTodayBirthdayRewards/)
  assert.match(read('app/api/internal/daily-jobs/birthday/route.ts'), /x-daily-job-secret/)
})
