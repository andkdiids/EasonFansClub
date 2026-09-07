import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('管理员资料编辑复用用户管理详情页、权限守卫和统一生日服务', () => {
  const route = read('app/api/admin/users/[userId]/route.ts')
  const page = read('app/admin/users/[id]/page.tsx')
  const editor = read('components/AdminUserProfileEditor.tsx')
  const service = read('lib/admin-user-profile.ts')

  assert.match(route, /requireAdmin\('user_manage'\)/)
  assert.match(route, /action === 'updateProfile'/)
  assert.match(route, /validateLoginAccountValue/)
  assert.match(route, /normalizeUserContactPatch/)
  assert.match(route, /isValidBirthdayParts/)
  assert.match(route, /updateAdminUserProfile\(tx, \{/)
  assert.match(route, /triggerBadgeEvaluation\(userId, 'USER_BIRTHDAY_UPDATED'/)

  assert.match(page, /<AdminUserProfileEditor/)
  for (const field of ['username', 'nickname', 'email', 'phone', 'bio', 'avatarUrl', 'backgroundUrl', 'birthMonth', 'birthDay', 'location', 'wallVisibility']) {
    assert.match(page, new RegExp(`${field}:`))
  }

  assert.match(editor, /<ConfirmDialog/)
  assert.match(editor, /确认修改该用户资料？/)
  assert.match(editor, /生日变更后，生日及星座勋章将根据新生日重新计算。/)
  assert.doesNotMatch(editor, /window\.confirm/)

  assert.match(service, /actor: 'ADMIN'/)
  assert.match(service, /action: 'UPDATE_USER_PROFILE'/)
  assert.match(service, /changedFields/)
  assert.match(service, /oldValue/)
  assert.match(service, /newValue/)
  assert.match(service, /maskContactValue/)
  assert.doesNotMatch(service, /userData\.birthdateSelfEditCount\s*=/)
  assert.doesNotMatch(service, /userData\.role\s*=/)
  assert.doesNotMatch(service, /userData\.(passwordHash|points|exp|experience)\s*=/)
})

test('用户管理列表展示用户名、生日和本人修改次数，且高影响列表操作使用 ConfirmDialog', () => {
  const list = read('app/api/admin/users/route.ts')
  const manager = read('components/AdminUsersManager.tsx')

  assert.match(list, /username: true/)
  assert.match(list, /birthdateSelfEditCount: true/)
  assert.match(manager, /@\{user\.username\}/)
  assert.match(manager, /本人修改/)
  assert.match(manager, /<ConfirmDialog/)
  assert.doesNotMatch(manager, /window\.confirm/)
})

test('管理员生日更新迁移只新增默认零的计数列，且不会执行生产迁移', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260907100000_add_birthdate_self_edit_count/migration.sql')
  assert.match(schema, /birthdateSelfEditCount\s+Int\s+@default\(0\)/)
  assert.match(migration, /ADD COLUMN `birthdateSelfEditCount` INT NOT NULL DEFAULT 0/)
  assert.doesNotMatch(migration, /UPDATE `User`|DELETE FROM|DROP TABLE/i)
})
