import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  getOrderedProfileRecordSectionKeys,
  normalizeProfileRecordPreferences,
  PROFILE_RECORD_SECTIONS,
} from '../lib/profile-record-sections'
import {
  DEFAULT_USER_PRIVACY_SETTINGS,
  getVisibleProfileModules,
  isProfileModuleVisible,
} from '../lib/user-privacy-types'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('个人记录使用统一配置，默认顺序保留并加入沙龙，留言墙不属于可排序区', () => {
  assert.deepEqual(PROFILE_RECORD_SECTIONS.map((section) => section.key), [
    'posts',
    'replies',
    'recent-messages',
    'salon',
    'achievements',
    'badges',
    'albums',
    'favorites',
  ])
  assert.deepEqual(normalizeProfileRecordPreferences([]).map((preference) => preference.key), PROFILE_RECORD_SECTIONS.map((section) => section.key))
  assert.equal(PROFILE_RECORD_SECTIONS.some((section) => String(section.key) === 'wall'), false)
})

test('历史用户缺少偏好时全部记录可见，自定义顺序和隐藏只作用于记录分区', () => {
  const defaults = normalizeProfileRecordPreferences([])
  assert.deepEqual(getOrderedProfileRecordSectionKeys(defaults), PROFILE_RECORD_SECTIONS.map((section) => section.key))

  const customized = normalizeProfileRecordPreferences([
    { section: 'salon', sortOrder: 1, isVisible: true },
    { section: 'replies', sortOrder: 2, isVisible: false },
    { section: 'posts', sortOrder: 3, isVisible: true },
  ])
  assert.deepEqual(getOrderedProfileRecordSectionKeys(customized), ['salon', 'posts', 'recent-messages', 'achievements', 'badges', 'albums', 'favorites'])
  assert.deepEqual(getOrderedProfileRecordSectionKeys(customized, true).slice(0, 3), ['salon', 'replies', 'posts'])
  assert.equal(customized.find((preference) => preference.key === 'replies')?.visible, false)
})

test('沙龙隐私开关复用现有个人主页隐私白名单，所有人可见默认值向后兼容', () => {
  assert.equal(DEFAULT_USER_PRIVACY_SETTINGS.showSalon, true)
  assert.equal(isProfileModuleVisible({ ...DEFAULT_USER_PRIVACY_SETTINGS, showSalon: false }, 'salon', false), false)
  assert.equal(isProfileModuleVisible({ ...DEFAULT_USER_PRIVACY_SETTINGS, showSalon: false }, 'salon', true), true)
  assert.ok(getVisibleProfileModules(DEFAULT_USER_PRIVACY_SETTINGS, false).includes('salon'))
  const form = source('components/UserPrivacySettingsForm.tsx')
  assert.match(form, /showSalon/)
  assert.match(form, /显示沙龙记录/)
})

test('个人主页先渲染完整记录区域，再渲染留言墙，留言墙仍复用原组件', () => {
  const surface = source('components/ProfilePageSurface.tsx')
  assert.ok(surface.indexOf('<PublicUserModules') >= 0)
  assert.ok(surface.indexOf('<PublicUserModules') < surface.indexOf('id="profile-wall"'))
  assert.match(surface, /<ProfileWall receiverUid=\{profile\.uid\} isOwner=\{isSelf\} \/>/)
  assert.doesNotMatch(surface, /grid-cols-\[minmax\(0,0\.92fr\)/)
})

test('沙龙个人记录只查询服务端公开作品，分页并链接现有详情页', () => {
  const salon = source('lib/salon.ts')
  const route = source('app/api/users/[userId]/public-modules/route.ts')
  const modules = source('components/PublicUserModules.tsx')
  assert.match(salon, /export async function getProfileSalonPosts\(userId: string, requestedPage = 1, viewerId\?: string \| null\)/)
  assert.match(salon, /const where: Prisma\.SalonPostWhereInput = \{ \.\.\.salonPublicBaseWhere, userId \}/)
  assert.match(salon, /status: 'APPROVED'/)
  assert.match(salon, /approvedAt: \{ not: null \}/)
  assert.match(salon, /skip: \(pagination\.page - 1\) \* pagination\.pageSize/)
  assert.match(route, /getProfileRecordPreferences\(target\.id\)/)
  assert.match(route, /getProfileSalonPosts\(target\.id, page, viewer\?\.id\)/)
  assert.match(modules, /href=\{`\/salon\/\$\{post\.id\}`\}/)
  assert.match(modules, /moduleKey === 'salon'/)
  assert.doesNotMatch(modules, /post\.status === 'PENDING'/)
})

test('隐藏记录由服务端模块接口拒绝，配置接口只允许当前登录用户保存完整分区配置', () => {
  const moduleRoute = source('app/api/users/[userId]/public-modules/route.ts')
  const preferenceRoute = source('app/api/profile/record-preferences/route.ts')
  assert.match(moduleRoute, /!visibility\.isSelf && recordPreferences\.find\(/)
  assert.match(moduleRoute, /visibility: \{ visible: false \}/)
  assert.match(preferenceRoute, /rejectInvalidRequestOrigin\(request\)/)
  assert.match(preferenceRoute, /requireUser\(\)/)
  assert.match(preferenceRoute, /userId_section: \{ userId: guard\.user\.id, section: preference\.key \}/)
  assert.match(preferenceRoute, /prisma\.\$transaction\(/)
  assert.match(preferenceRoute, /profileRecordPreference\.upsert/)
  assert.doesNotMatch(preferenceRoute, /body\?\.(userId|targetUserId)/)
})

test('记录管理移动端提供上移下移和显示切换，隐藏不会删除内容', () => {
  const settings = source('components/ProfileRecordSettings.tsx')
  const migration = source('prisma/migrations/20260831120000_add_profile_record_preferences_and_salon_privacy/migration.sql')
  assert.match(settings, /上移\$\{label\}/)
  assert.match(settings, /下移\$\{label\}/)
  assert.match(settings, /role="switch"/)
  assert.match(settings, /\/api\/profile\/record-preferences/)
  assert.match(migration, /CREATE TABLE `ProfileRecordPreference`/)
  assert.match(migration, /UNIQUE INDEX `ProfileRecordPreference_userId_section_key`/)
  assert.doesNotMatch(migration, /DELETE FROM|DROP TABLE|TRUNCATE/i)
  assert.match(source('prisma/schema.prisma'), /model ProfileRecordPreference \{[\s\S]*?isVisible\s+Boolean\s+@default\(true\)/)
})
