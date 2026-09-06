import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  getCheckInTypeMeta,
  isMakeupCheckInType,
  MAKEUP_CHECK_IN_TYPES,
  normalizeCheckInType,
} from '../lib/checkin-type-meta'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('类型元数据：NORMAL 前台显示已挂号、后台正常挂号', () => {
  const meta = getCheckInTypeMeta('NORMAL')
  assert.equal(meta.frontLabel, '已挂号')
  assert.equal(meta.adminLabel, '正常挂号')
  assert.equal(meta.isMakeup, false)
  assert.equal(meta.category, 'NORMAL')
})

test('类型元数据：三种补签前台统一显示补签', () => {
  for (const type of MAKEUP_CHECK_IN_TYPES) {
    const meta = getCheckInTypeMeta(type)
    assert.equal(meta.frontLabel, '补签')
    assert.equal(meta.isMakeup, true)
    assert.equal(meta.category, 'MAKEUP')
  }
})

test('类型元数据：后台细分 免费答题/付费/管理员 三种补签来源', () => {
  assert.equal(getCheckInTypeMeta('MAKEUP_FREE_QUIZ').adminLabel, '免费答题补签')
  assert.equal(getCheckInTypeMeta('MAKEUP_PAID').adminLabel, '付费补签')
  assert.equal(getCheckInTypeMeta('MAKEUP_ADMIN').adminLabel, '管理员补签')
  assert.equal(isMakeupCheckInType('MAKEUP_FREE_QUIZ'), true)
  assert.equal(isMakeupCheckInType('NORMAL'), false)
})

test('历史兼容：旧数据 type=NULL/空/未知一律按 NORMAL 处理，不显示为补签或未知', () => {
  for (const value of [null, undefined, '', 'MISSING', 'UNKNOWN']) {
    assert.equal(normalizeCheckInType(value), 'NORMAL')
    const meta = getCheckInTypeMeta(value)
    assert.equal(meta.frontLabel, '已挂号')
    assert.equal(meta.isMakeup, false)
  }
})

test('数据事实源：CheckIn 即唯一记录表，type/madeUpAt/makeupCost/challengeId 已存在且不再新建第二套补签表', () => {
  const schema = source('prisma/schema.prisma')
  const checkInModel = schema.slice(schema.indexOf('model CheckIn {'), schema.indexOf('model MakeupChallenge {')).replace(/\/\/.*$/gm, '')
  assert.match(checkInModel, /type\s+CheckInType\s+@default\(NORMAL\)/)
  assert.match(checkInModel, /madeUpAt\s+DateTime\?/)
  assert.match(checkInModel, /makeupCost\s+Int\?/)
  assert.match(checkInModel, /challengeId\s+String\?\s+@unique/)
  assert.match(checkInModel, /@@unique\(\[userId, checkinDateKey\]\)/)
  assert.doesNotMatch(schema, /model (MakeupRecord|CheckInMakeupLog|MakeupLog)\b/)
})

test('日期语义：三条补签写入统一以目标日期为 checkinDateKey、以执行为 madeUpAt', () => {
  const lib = source('lib/checkin-makeup.ts')
  const paid = source('app/api/checkin/makeup/paid/route.ts')
  const answer = source('app/api/checkin/makeup/challenge/[challengeId]/answer/route.ts')
  const admin = source('app/api/admin/checkin-makeup/route.ts')
  // 统一创建入口：目标日期写 checkinDateKey/checkDate，执行时间写 madeUpAt
  assert.match(lib, /type: input\.type/)
  assert.match(lib, /madeUpAt: now/)
  assert.match(lib, /checkinDateKey: input\.targetDateKey/)
  assert.match(lib, /checkDate: targetDate/)
  // 三条路径各自以正确 type/cost 走同一入口
  assert.match(paid, /type: 'MAKEUP_PAID'/)
  assert.match(paid, /cost: CHECK_IN_MAKEUP_COST/)
  assert.match(paid, /createMakeupCheckIn\(tx,/)
  assert.match(answer, /type: 'MAKEUP_FREE_QUIZ'/)
  assert.match(answer, /challengeId: challenge\.id/)
  assert.match(answer, /createMakeupCheckIn\(tx,/)
  assert.match(admin, /type: 'MAKEUP_ADMIN'/)
  assert.match(admin, /createMakeupCheckIns\(tx,/)
})

test('前台月历（个人主页）区分补签并返回 type 字段', () => {
  const profileModule = source('components/ProfileDeferredModules.tsx')
  const profileApi = source('app/api/profile/checkins/route.ts')
  assert.match(profileModule, /getCheckInTypeMeta\(record\.type\)/)
  assert.match(profileModule, /isMakeupDay \? typeMeta!\.frontLabel/)
  assert.match(profileApi, /type: true, isMakeUp: true, madeUpAt: true, makeupCost: true/)
})

test('前台挂号历史月历与详情：正常=已挂号，补签=补签，详情展示细分来源', () => {
  const dialog = source('components/CheckInHistoryDialog.tsx')
  assert.doesNotMatch(dialog, /已补签/)
  assert.match(dialog, /getCheckInTypeMeta\(visibleRecord\.type\)/)
  assert.match(dialog, /frontLabel/)
  assert.match(dialog, /挂号方式<\/dt><dd>\{getCheckInTypeMeta\(detail\.type\)\.adminLabel\}/)
  assert.match(dialog, /aria-label=\{`\$\{cell\.key\}，\$\{madeUp \? '补签'/)
})

test('后台最近签到概览不再合并免费与付费，细分来源', () => {
  const page = source('app/admin/checkin-makeup/AdminCheckInMakeup.tsx')
  assert.doesNotMatch(page, /用户补签/)
  assert.match(page, /getCheckInTypeMeta\(type\)\.adminLabel/)
})

test('后台补签记录列表：按来源筛选 + 昵称/UID 搜索 + 被补签日期 + 分页', () => {
  const route = source('app/api/admin/checkin-makeup/records/route.ts')
  assert.match(route, /requireAdmin\('checkin_manage'\)/)
  assert.match(route, /type: \{ in: resolveTypeFilter\(typeFilter\) \}/)
  assert.match(route, /filter === 'FREE_QUIZ'\) return \['MAKEUP_FREE_QUIZ'\]/)
  assert.match(route, /filter === 'PAID'\) return \['MAKEUP_PAID'\]/)
  assert.match(route, /return \['MAKEUP_ADMIN'\]/)
  assert.match(route, /searchParams\.get\('q'\)/)
  assert.match(route, /uid: numericQuery/)
  assert.match(route, /searchParams\.get\('targetDateKey'\) \?\? searchParams\.get\('targetDate'\)/)
  assert.match(route, /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/)
  assert.match(route, /action: 'CHECK_IN_ADMIN_MAKEUP'/)
  assert.match(route, /detail\.checkInId/)
  assert.match(route, /makeupCost: row\.makeupCost/)
  assert.match(route, /madeUpAt: row\.madeUpAt\?\.toISOString\(\) \|\| null/)
})

test('后台补签记录页面：展示用户/日期/方式/时间/花费/操作人/挑战并提供筛选与翻页', () => {
  const page = source('app/admin/checkin-makeup/AdminCheckInMakeupRecords.tsx')
  assert.match(page, /\/api\/admin\/checkin-makeup\/records/)
  for (const label of ['全部补签', '免费答题补签', '付费补签', '管理员补签']) {
    assert.ok(page.includes(label), `缺少筛选项：${label}`)
  }
  for (const column of ['被补签日期', '补签方式', '实际补签时间', '补签花费', '操作人', '免费挑战']) {
    assert.ok(page.includes(column), `缺少列：${column}`)
  }
  assert.match(page, /targetUser\.avatarUrl/)
  assert.match(page, /makeupCost/)
  assert.match(page, /operator\.nickname/)
  assert.match(page, /上一页/)
  assert.match(page, /下一页/)
  // 「补签记录」区块挂在现有手动补签管理页（不新增一级导航），标题位于记录组件内
  assert.ok(page.includes('补签记录'))
  const adminPage = source('app/admin/checkin-makeup/page.tsx')
  assert.match(adminPage, /<AdminCheckInMakeupRecords \/>/)
})

test('重复补签防护：同用户同目标日期唯一 + 路由层拒绝再次补签', () => {
  const lib = source('lib/checkin-makeup.ts')
  const adminRoute = source('app/api/admin/checkin-makeup/route.ts')
  assert.match(lib, /ALREADY_CHECKED_IN/)
  assert.match(lib, /findUnique\(/)
  assert.match(lib, /userId_checkinDateKey/)
  assert.match(adminRoute, /existing\.length\) throw new CheckInMakeupError/)
  assert.match(adminRoute, /ALREADY_CHECKED_IN/)
})

test('管理员补签审计：写入既有 AdminActionLog 且含被补日期/类型/checkInId', () => {
  const route = source('app/api/admin/checkin-makeup/route.ts')
  assert.match(route, /action: 'CHECK_IN_ADMIN_MAKEUP'/)
  assert.match(route, /source: 'MAKEUP_ADMIN'/)
  assert.match(route, /targetDate: targetDateKeys\[index\]/)
  assert.match(route, /checkInId: checkIn\.id/)
})

test('今日状态按目标日期判定：补签过去日期不会让今天误判已挂号', () => {
  const route = source('app/api/checkin/route.ts')
  assert.match(route, /checkedToday: Boolean\(todayCheckIn\)/)
  assert.match(route, /userId_checkinDateKey: \{ userId: user\.id, checkinDateKey: todayKey \}/)
  const lib = source('lib/checkin-makeup.ts')
  assert.match(lib, /TODAY_NOT_ALLOWED/)
  assert.match(lib, /targetDateKey >= todayKey/)
})
