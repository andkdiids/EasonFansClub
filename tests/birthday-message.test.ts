import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const birthdayLib = read('lib/birthday.ts')
const schema = read('prisma/schema.prisma')
const permissionConfig = read('lib/admin-permission-config.ts')
const adminNavigation = read('lib/admin-navigation.ts')
const listRoute = read('app/api/admin/birthday-messages/route.ts')
const itemRoute = read('app/api/admin/birthday-messages/[id]/route.ts')

// 文案池相关源码切片
const birthdayModel = schema.slice(schema.indexOf('model BirthdayMessage'), schema.indexOf('model TodayEvent'))
const pickFn = birthdayLib.slice(
  birthdayLib.indexOf('async function pickBirthdayMessage'),
  birthdayLib.indexOf('export async function sendBirthdayGreeting'),
)
const greetFn = birthdayLib.slice(
  birthdayLib.indexOf('export async function sendBirthdayGreeting'),
  birthdayLib.indexOf('export async function grantTodayBirthdayRewards'),
)
const notificationModel = schema.slice(schema.indexOf('model Notification'))

test('BirthdayMessage schema model exists with expected fields (DB)', () => {
  assert.match(birthdayModel, /model BirthdayMessage/)
  assert.match(birthdayModel, /id\s+String\s+@id @default\(cuid\(\)\)/)
  assert.match(birthdayModel, /title\s+String/)
  assert.match(birthdayModel, /content\s+String\s+@db\.Text/)
  assert.match(birthdayModel, /isActive\s+Boolean\s+@default\(true\)/)
  assert.match(birthdayModel, /createdAt\s+DateTime\s+@default\(now\(\)\)/)
  assert.match(birthdayModel, /updatedAt\s+DateTime\s+@updatedAt/)
  assert.match(birthdayModel, /@@index\(\[isActive\]\)/)
})

test('enabled message is selected from the active pool when sending (1: 启用文案可发送)', () => {
  // sendBirthdayGreeting 改用文案池随机结果
  assert.match(greetFn, /await pickBirthdayMessage\(\)/)
  // 创建通知使用池中的 title / content（不再是硬编码常量）
  assert.match(greetFn, /const \{ title, content \} = await pickBirthdayMessage\(\)/)
  assert.match(greetFn, /title,/)
  assert.match(greetFn, /content,/)
  // 文案池只查询启用文案
  assert.match(pickFn, /prisma\.birthdayMessage\.findMany/)
  assert.match(pickFn, /where:\s*\{\s*isActive:\s*true\s*\}/)
})

test('disabled messages are excluded from the random pool (2: 停用文案被排除)', () => {
  // 查询条件仅按 isActive:true 过滤，不存在 isActive:false 的取数分支
  assert.match(pickFn, /where:\s*\{\s*isActive:\s*true\s*\}/)
  assert.doesNotMatch(pickFn, /isActive:\s*false/)
})

test('multiple messages are chosen randomly (3: 随机选择)', () => {
  assert.match(pickFn, /messages\.length > 0/)
  assert.match(pickFn, /Math\.floor\(Math\.random\(\) \* messages\.length\)/)
  assert.match(pickFn, /messages\[/)
})

test('empty pool falls back to default greeting (4: 无文案回退)', () => {
  // 池为空时回退到默认标题与内容常量
  assert.match(pickFn, /messages\.length > 0[\s\S]*return \{\s*title: BIRTHDAY_GREETING_TITLE, content: BIRTHDAY_GREETING_CONTENT\s*\}/)
  // 数据库异常也被 catch 并回退，保证发送流程不中断
  assert.match(pickFn, /catch \(error\)/)
  assert.match(pickFn, /console\.error\('\[birthday\.pickMessage\]'/)
  // 默认常量仍保留，供回退与前端兜底
  assert.match(birthdayLib, /BIRTHDAY_GREETING_TITLE = '🎂 生日纪念'/)
  assert.match(birthdayLib, /BIRTHDAY_GREETING_CONTENT =\n?\s*'[^`]*'/)
})

test('birthday greeting is sent at most once per user per year (5: 同用户同年只发一次)', () => {
  // 去重 key 由前缀常量 + 年份组成：birthday-greeting-${year}
  assert.match(birthdayLib, /BIRTHDAY_GREETING_KEY_PREFIX = 'birthday-greeting'/)
  assert.match(greetFn, /BIRTHDAY_GREETING_KEY_PREFIX\}-\$\{year\}/)
  assert.match(greetFn, /prisma\.notification\.findFirst/)
  assert.match(greetFn, /BIRTHDAY_GREETING/)
  // 复用 Notification 唯一约束 (recipientId, key) 兜底，防止并发重复
  assert.match(notificationModel, /@@unique\(\[recipientId, key\]\)/)
})

test('admin CRUD routes are guarded by the dedicated permission', () => {
  assert.match(listRoute, /requireAdmin\('birthday_messages_manage'\)/)
  assert.match(itemRoute, /requireAdmin\('birthday_messages_manage'\)/)
})

test('dashboard link and permission key are registered', () => {
  assert.match(permissionConfig, /'birthday_messages_manage'/)
  assert.match(permissionConfig, /\/admin\/birthday-messages': 'birthday_messages_manage'/)
  assert.match(adminNavigation, /\/admin\/birthday-messages/)
})
