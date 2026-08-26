import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getPhoneLookupVariants } from '../lib/phone-number'
import { normalizeUserContactPatch } from '../lib/user-contact'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('管理员联系方式标准化只产生 User canonical 值', () => {
  assert.deepEqual(normalizeUserContactPatch({ email: '  Admin@Example.com ', phone: '138 0013 8000', phoneCountry: 'CN' }), {
    email: 'admin@example.com',
    phone: '+8613800138000',
    phoneCountry: 'CN',
  })
  assert.deepEqual(normalizeUserContactPatch({ email: '', phone: '' }), { email: null, phone: null })
})

test('新旧手机号输入归一到同一组 User.phone lookup 值', () => {
  const national = getPhoneLookupVariants('13712345678', 'CN')
  const international = getPhoneLookupVariants('+8613712345678', 'CN')
  const internationalZeroPrefix = getPhoneLookupVariants('008613712345678', 'CN')
  assert.deepEqual(national, ['+8613712345678', '13712345678'])
  assert.deepEqual(international, national)
  assert.deepEqual(internationalZeroPrefix, national)
})

test('管理员手机号/邮箱修改在同一事务内处理冲突、验证状态和审计', () => {
  const route = source('app/api/admin/users/[userId]/route.ts')
  const service = source('lib/admin-user-contact.ts')
  const contact = `${route}\n${service}`
  assert.match(contact, /action === 'updateEmail' \|\| action === 'updatePhone' \|\| action === 'updateContact'/)
  assert.match(contact, /normalizeUserContactPatch/)
  assert.match(contact, /prisma\.\$transaction/)
  assert.match(contact, /withMySqlAdvisoryLocks/)
  assert.match(contact, /EMAIL_ALREADY_EXISTS/)
  assert.match(contact, /PHONE_ALREADY_EXISTS/)
  assert.match(contact, /data\.emailVerifiedAt = null/)
  assert.match(contact, /data\.phoneVerifiedAt = null/)
  assert.match(contact, /data\.verificationStatus = nextEmail \? 'PENDING' : 'NONE'/)
  assert.match(contact, /action: 'UPDATE_USER_CONTACT'/)
  assert.match(contact, /maskContactValue/)
  assert.match(contact, /error\.code === 'P2002'/)
  assert.match(contact, /where: \{ id: userId \}/)
  assert.match(contact, /id: true,\s+uid: true/)
  assert.doesNotMatch(contact, /tx\.user\.create/)
  assert.doesNotMatch(contact, /passwordHash\s*:/)
})

test('登录和找回密码都复用 User.phone 的标准化 lookup', () => {
  const users = source('lib/users.ts')
  const login = source('app/api/auth/login/route.ts')
  const securityQuestions = source('app/api/auth/forgot-password/security/questions/route.ts')
  const emailSend = source('app/api/auth/forgot-password/email/send/route.ts')
  const emailVerify = source('app/api/auth/forgot-password/email/verify/route.ts')
  assert.match(users, /export function getLoginIdentifierWhere/)
  assert.match(users, /getPhoneLookupVariants\(normalized, phoneCountry\)/)
  assert.match(users, /phone: \{ in: phoneVariants\.length \? phoneVariants : \[normalized\] \}/)
  assert.match(users, /export function getContactLoginWhere/)
  assert.match(users, /\.\.\.getContactLoginWhere\(identifierType, normalized, phoneCountry\)/)
  assert.match(users, /return \{ email: normalized\.toLowerCase\(\) \}/)
  assert.match(login, /findCompleteUserByLoginIdentifier\(identifierType, identifier, requestedPhoneCountry\)/)
  assert.match(login, /createSessionToken\(sessionUser\)/)
  assert.doesNotMatch(login, /identifierType === 'phone' && !user\.phoneVerifiedAt/)
  assert.match(login, /identifierType === 'email' && !user\.emailVerifiedAt/)
  for (const route of [securityQuestions, emailSend, emailVerify]) assert.match(route, /getLoginIdentifierWhere\(identifier\)/)
  assert.doesNotMatch(securityQuestions, /\{ phone: identifier \}/)
  assert.doesNotMatch(emailSend, /\{ phone: identifier \}/)
  assert.doesNotMatch(emailVerify, /\{ phone: identifier \}/)
})

test('后台保存后重新读取列表，删除确认同时返回同一 User 联系方式与验证状态', () => {
  const manager = source('components/AdminUsersManager.tsx')
  const deletion = source('lib/admin-user-deletion.ts')
  const detail = source('app/admin/users/[id]/page.tsx')
  assert.match(manager, /action: 'updateContact'/)
  assert.match(manager, /await loadUsers\(query\)/)
  assert.match(manager, /InternationalPhoneInput/)
  assert.match(deletion, /phone: true,\s*email: true,\s*phoneVerifiedAt: true,\s*emailVerifiedAt: true/)
  assert.match(manager, /preview\.user\.phoneVerifiedAt/)
  assert.match(manager, /preview\.user\.emailVerifiedAt/)
  assert.match(detail, /emailVerifiedAt: true, phoneVerifiedAt: true/)
  assert.match(detail, /export const dynamic = 'force-dynamic'/)
})
