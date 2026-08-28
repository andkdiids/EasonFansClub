import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  DEFAULT_USER_PRIVACY_SETTINGS,
  PUBLIC_PROFILE_MODULE_KEYS,
  getVisibleProfileModules,
  isProfileModuleVisible,
  type UserPrivacySettings,
} from '../lib/user-privacy-types'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('隐私默认值全部公开，历史用户无需批量创建设置记录', () => {
  assert.deepEqual(DEFAULT_USER_PRIVACY_SETTINGS, {
    showCheckInHistory: true,
    showCheckInMessages: true,
    showPosts: true,
    showComments: true,
    showConcertHistory: true,
    showActivityHistory: true,
    showBadgeHistory: true,
    showRatings: true,
  })
  assert.deepEqual(getVisibleProfileModules(DEFAULT_USER_PRIVACY_SETTINGS, false), PUBLIC_PROFILE_MODULE_KEYS)
  assert.deepEqual(getVisibleProfileModules({ ...DEFAULT_USER_PRIVACY_SETTINGS, showPosts: false }, true), PUBLIC_PROFILE_MODULE_KEYS)
  assert.match(source('lib/user-privacy.ts'), /normalizeUserPrivacySettings\(row\)/)
  assert.doesNotMatch(source('prisma/migrations/20260828090000_add_user_privacy_settings/migration.sql'), /INSERT INTO|UPDATE `?User|UPDATE `?Post|DELETE FROM/i)
})

test('关闭个人主页模块只影响对应服务端模块，好友和管理员不会绕过', () => {
  const hidden: UserPrivacySettings = {
    ...DEFAULT_USER_PRIVACY_SETTINGS,
    showCheckInMessages: false,
    showPosts: false,
    showComments: false,
    showBadgeHistory: false,
    showConcertHistory: false,
  }
  assert.equal(isProfileModuleVisible(hidden, 'posts', false), false)
  assert.equal(isProfileModuleVisible(hidden, 'replies', false), false)
  assert.equal(isProfileModuleVisible(hidden, 'recent-messages', false), false)
  assert.equal(isProfileModuleVisible(hidden, 'badges', false), false)
  assert.equal(isProfileModuleVisible(hidden, 'posts', true), true)
  assert.match(source('app/api/users/[userId]/public-modules/route.ts'), /getProfileVisibility\(target\.id, viewer\?\.id\)/)
  assert.match(source('app/api/users/[userId]/public-modules/route.ts'), /isProfileModuleVisible\(visibility\.settings, typedModuleKey, visibility\.isSelf\)/)
  assert.match(source('app/api/users/[userId]/badges/route.ts'), /!visibility\.isSelf && !visibility\.settings\.showBadgeHistory/)
  assert.match(source('app/api/music/live/users/[uid]/route.ts'), /!visibility\.isSelf && !visibility\.settings\.showConcertHistory/)
})

test('头像菜单将隐私设置放在账号安全后、后台管理前并保留管理员判断', () => {
  const menu = source('components/UserNotificationMenu.tsx')
  const securityIndex = menu.indexOf('href="/settings/security"')
  const privacyIndex = menu.indexOf('href="/settings/privacy"')
  const adminIndex = menu.indexOf('href="/admin"')
  assert.ok(securityIndex >= 0 && securityIndex < privacyIndex)
  assert.ok(privacyIndex < adminIndex)
  assert.match(menu, /isAdmin \? <Link href="\/admin"/)
  assert.match(menu, /隐私设置/)
})

test('隐私设置页面和接口只允许当前登录用户更新白名单字段', () => {
  const page = source('app/settings/privacy/page.tsx')
  const form = source('components/UserPrivacySettingsForm.tsx')
  const route = source('app/api/settings/privacy/route.ts')
  assert.match(page, /隐私设置/)
  for (const label of ['显示挂号记录', '显示挂号留言', '显示发帖记录', '显示评论记录', '显示演唱会记录', '显示活动记录', '显示勋章记录', '显示评分与榜单']) assert.match(form, new RegExp(label))
  assert.match(route, /rejectInvalidRequestOrigin\(request\)/)
  assert.match(route, /requireUser\(\)/)
  assert.match(route, /where: \{ userId: guard\.user\.id \}/)
  assert.match(route, /USER_PRIVACY_KEYS/)
  assert.doesNotMatch(route, /body\?\.(userId|targetUserId)/)
  assert.doesNotMatch(route, /data:\s*body\s*[,}]/)
})

test('个人主页服务端先判断隐私再查询记录，当前佩戴勋章仍独立保留', () => {
  const profile = source('app/user/[uid]/page.tsx')
  const surface = source('components/ProfilePageSurface.tsx')
  const modules = source('components/PublicUserModules.tsx')
  const livePage = source('app/user/[uid]/live/page.tsx')
  assert.match(profile, /getProfileVisibility\(user\.id, viewer\?\.id\)/)
  assert.match(profile, /visibility\.isSelf \|\| visibility\.settings\.showCheckInMessages/)
  assert.match(profile, /visibility\.isSelf \|\| visibility\.settings\.showBadgeHistory/)
  assert.match(profile, /visibility\.isSelf \|\| visibility\.settings\.showConcertHistory/)
  assert.match(surface, /profile\.privacy\.showBadgeHistory/)
  assert.match(surface, /equippedBadge=\{profile\.equippedBadge\}/)
  assert.match(modules, /visibleModules\?: readonly ModuleKey\[\]/)
  assert.match(modules, /visibleTabs\.map/)
  assert.match(livePage, /getProfileVisibility\(user\.id, viewer\?\.id\)/)
  assert.match(livePage, /isPublic: true/)
})

test('公开帖子、公开评论、活动报名和本人娱乐数据不因主页隐私开关被删除或改为私密', () => {
  const modules = source('app/api/users/[userId]/public-modules/route.ts')
  const live = source('app/api/music/live/users/[uid]/route.ts')
  assert.match(modules, /buildProfilePostWhere\(target\.id, canViewPendingPosts\)/)
  assert.doesNotMatch(modules, /prisma\.(post|reply|dailyMessage|userBadge|userAchievement)\.(update|delete|deleteMany)/)
  assert.match(live, /isPublic: true/)
  assert.doesNotMatch(live, /prisma\.userMusicConcert\.(update|delete|deleteMany)/)
  assert.match(source('app/api/music/live/concerts/[concertId]/attendance/route.ts'), /guard\.user\.id/)
})

test('隐私设置迁移使用安全默认值并建立一对一用户关系', () => {
  const schema = source('prisma/schema.prisma')
  const migration = source('prisma/migrations/20260828090000_add_user_privacy_settings/migration.sql')
  assert.match(schema, /UserPrivacySetting\s+UserPrivacySetting\?/) 
  assert.match(schema, /model UserPrivacySetting \{[\s\S]*?userId\s+String\s+@unique[\s\S]*?showRatings\s+Boolean\s+@default\(true\)[\s\S]*?User\s+User\s+@relation\(/)
  assert.match(migration, /CREATE TABLE `UserPrivacySetting`/)
  assert.match(migration, /`showCheckInHistory` BOOLEAN NOT NULL DEFAULT true/)
  assert.match(migration, /`showRatings` BOOLEAN NOT NULL DEFAULT true/)
  assert.match(migration, /UNIQUE INDEX `UserPrivacySetting_userId_key`/)
  assert.match(migration, /ON DELETE CASCADE ON UPDATE CASCADE/)
})
