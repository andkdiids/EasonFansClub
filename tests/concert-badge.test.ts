import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const read = (p: string) => readFileSync(`${root}/${p}`, 'utf8')

const schema = read('prisma/schema.prisma')
const grant = read('lib/concert-badge.ts')
const attendance = read('app/api/music/live/concerts/[concertId]/attendance/route.ts')
const createApi = read('app/api/admin/music/badges/route.ts')
const adminNav = read('app/admin/music/page.tsx')

test('Badge 模型新增 category 枚举与 musicTourId 关联（复用现有 Badge / UserBadge）', () => {
  assert.match(schema, /enum BadgeCategory\s*\{[\s\S]*?SYSTEM[\s\S]*?BIRTHDAY[\s\S]*?CONCERT/)
  assert.match(schema, /model Badge\s*\{[\s\S]*?musicTourId\s+String\?/)
  assert.match(schema, /musicTour\s+MusicTour\?\s+@relation\(fields:\s*\[musicTourId\]/)
  // 不破坏生日徽章逻辑：仍按 slug 唯一授予
  assert.match(schema, /model UserBadge\s*\{[\s\S]*?@@unique\(\[userId,\s*badgeId\]\)/)
})

test('1. 添加 DUO 场次后授予 DUO 徽章（查 tour → 查启用徽章 → 授予）', () => {
  assert.match(grant, /prisma\.musicConcert\.findUnique/)
  assert.match(grant, /prisma\.badge\.findFirst\(\{\s*where:\s*\{[\s\S]*?musicTourId:/)
  assert.match(grant, /category:\s*'CONCERT'/)
  assert.match(grant, /isActive:\s*true/)
  assert.match(grant, /prisma\.userBadge\.upsert/)
})

test('2. 同巡演多个场次只获得一次（UserBadge 唯一约束兜底）', () => {
  assert.match(grant, /userId_badgeId:\s*\{\s*userId,\s*badgeId/)
})

test('3. 不同巡演获得不同徽章（按场次所属 tour 查询）', () => {
  assert.match(grant, /musicTourId:\s*concert\.tourId/)
})

test('4. 没有绑定徽章的巡演不授予（无启用徽章则提前返回）', () => {
  assert.match(grant, /if\s*\(!badge\)\s*return/)
})

test('5. 普通用户不能创建徽章（创建接口必须管理员权限）', () => {
  assert.match(createApi, /requireAdmin\('music_manage'\)/)
  assert.match(createApi, /if\s*\(!guard\.user\)\s*return guard\.response/)
  // 创建接口把 category 固定为 CONCERT 并强制关联巡演
  assert.match(createApi, /category:\s*'CONCERT'/)
  assert.match(createApi, /请选择关联的巡演/)
})

test('接入我的现场：成功保存后触发自动授予且失败不影响主流程', () => {
  assert.match(attendance, /import\s*\{[^}]*checkConcertBadge[^}]*\}\s*from\s*'@\/lib\/concert-badge'/)
  assert.match(attendance, /await checkConcertBadge\(guard\.user\.id,\s*concertId\)/)
  // 包在 try/catch 中，异常仅记录日志
  assert.match(attendance, /catch\s*\(error\)\s*\{\s*\n?\s*console\.error\('\[attendance\.concertBadge\]'/)
})

test('后台演唱会徽章入口已挂载到音乐管理页', () => {
  assert.match(adminNav, /\/admin\/music\/badges/)
})

test('个人主页徽章展示已覆盖 CONCERT 分类（无需改显示逻辑）', () => {
  // public-modules API 返回全部 UserBadge，无 category 过滤，CONCERT 徽章自动出现
  const pub = read('app/api/users/[userId]/public-modules/route.ts')
  assert.match(pub, /prisma\.userBadge\.findMany\(\{\s*where:\s*\{\s*userId:\s*target\.id,\s*isHidden:\s*false/)
})
