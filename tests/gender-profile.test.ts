import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CUSTOM_GENDER_MAX_LENGTH,
  getGenderDisplay,
  isProfileGenderComplete,
  validateGenderInput,
} from '../lib/gender'

const read = (path: string) => readFileSync(path, 'utf8')

test('性别解析器区分显式保密、自定义和历史未设置状态', () => {
  assert.equal(getGenderDisplay({ gender: null, customGender: null }), null)
  assert.equal(getGenderDisplay({ gender: 'MALE', customGender: '错误值' }), '男')
  assert.equal(getGenderDisplay({ gender: 'FEMALE', customGender: null }), '女')
  assert.equal(getGenderDisplay({ gender: 'CUSTOM', customGender: '  非二元  ' }), '非二元')
  assert.equal(getGenderDisplay({ gender: 'CUSTOM', customGender: '   ' }), null)
  assert.equal(getGenderDisplay({ gender: 'PRIVATE', customGender: '旧自定义值' }), null)

  assert.deepEqual(validateGenderInput('MALE', 'ignored'), { gender: 'MALE', customGender: null, error: null })
  assert.deepEqual(validateGenderInput('PRIVATE', 'ignored'), { gender: 'PRIVATE', customGender: null, error: null })
  assert.deepEqual(validateGenderInput('', ''), { gender: null, customGender: null, error: null })
  assert.equal(validateGenderInput('CUSTOM', '非二元').error, null)
  assert.ok(validateGenderInput('CUSTOM', '').error)
  assert.ok(validateGenderInput('CUSTOM', 'line\nfeed').error)
  assert.ok(validateGenderInput('CUSTOM', '<b>非二元</b>').error)
  assert.ok(validateGenderInput('CUSTOM', 'a'.repeat(CUSTOM_GENDER_MAX_LENGTH + 1)).error)
  assert.ok(validateGenderInput('invalid', '').error)

  assert.equal(isProfileGenderComplete({ gender: null, customGender: null }), false)
  assert.equal(isProfileGenderComplete({ gender: 'MALE', customGender: null }), true)
  assert.equal(isProfileGenderComplete({ gender: 'FEMALE', customGender: null }), true)
  assert.equal(isProfileGenderComplete({ gender: 'PRIVATE', customGender: '旧自定义值' }), true)
  assert.equal(isProfileGenderComplete({ gender: 'CUSTOM', customGender: '非二元' }), true)
  assert.equal(isProfileGenderComplete({ gender: 'CUSTOM', customGender: '   ' }), false)
})

test('性别字段贯通资料编辑、公开资料卡和好友资料卡，侧栏不展示勋章', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260907110000_add_user_gender/migration.sql')
  const privateMigration = read('prisma/migrations/20260908110000_add_private_gender/migration.sql')
  const selfApi = read('app/api/users/me/route.ts')
  const adminApi = read('app/api/admin/users/[userId]/route.ts')
  const profileForm = read('app/profile/ProfileSettingsForm.tsx')
  const adminForm = read('components/AdminUserProfileEditor.tsx')
  const surface = read('components/ProfilePageSurface.tsx')
  const friendCard = read('components/FriendProfileCard.tsx')
  const sidebar = read('components/UserProfileSummary.tsx')

  assert.match(schema, /enum Gender\s*\{\s*MALE\s+FEMALE\s+CUSTOM\s+PRIVATE\s*\}/u)
  assert.match(schema, /gender\s+Gender\?/u)
  assert.match(schema, /customGender\s+String\?\s+@db\.VarChar\(20\)/u)
  assert.match(migration, /ADD COLUMN `gender` ENUM\('MALE', 'FEMALE', 'CUSTOM'\) NULL/u)
  assert.match(migration, /ADD COLUMN `customGender` VARCHAR\(20\) NULL/u)
  assert.match(privateMigration, /MODIFY COLUMN `gender` ENUM\('MALE', 'FEMALE', 'CUSTOM', 'PRIVATE'\) NULL/u)
  assert.match(selfApi, /validateGenderInput/)
  assert.match(selfApi, /checkBannedWords\(genderValidation\.customGender\)/)
  assert.match(adminApi, /validateGenderInput/)
  assert.match(profileForm, /name="profile-gender"/)
  assert.match(profileForm, /\['PRIVATE', '保密'\]/)
  assert.doesNotMatch(profileForm, /不设置/)
  assert.match(profileForm, /data\.profile\.gender === 'PRIVATE'/)
  assert.match(adminForm, /name="admin-profile-gender"/)
  assert.match(adminForm, /\['PRIVATE', '保密'\]/)
  assert.match(adminForm, /data\?\.user\?\.gender === 'PRIVATE'/)
  assert.match(surface, /getGenderDisplay\(profile\)/)
  assert.match(surface, /性别/)
  assert.match(friendCard, /getGenderDisplay\(friend\)/)
  assert.match(friendCard, /性别：\{genderDisplay\}/)
  assert.match(selfApi, /refreshProfileCompletion\(guard\.user\.id, now\)/)
  assert.match(read('components/GrowthPanel.tsx'), /window\.addEventListener\('profile-updated'/)
  assert.match(sidebar, /showBadge=\{false\}/)
  assert.doesNotMatch(sidebar, /equippedBadges|equippedBadge/)
})
