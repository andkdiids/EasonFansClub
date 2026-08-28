import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('notification unread summary and list share the same personal visibility/category source', () => {
  const notifications = read('lib/notifications.ts')
  const client = read('app/notifications/NotificationsClient.tsx')

  assert.match(notifications, /getNotificationVisibilityFilter\(userId/)
  assert.match(notifications, /getUnreadNotificationWhere\(userId/)
  assert.match(notifications, /getNotificationCategory\(item\.type, link, item\.key\)/)
  assert.match(notifications, /reconcileStalePersonalNotifications/)
  assert.doesNotMatch(notifications, /prisma\.friendRequest\.count\(/)
  assert.match(client, /const zeroSummary: UnreadSummary/)
  assert.match(client, /setSummaryOverride\(zeroSummary\)/)
})

test('friend request notifications are keyed and direct decisions mark only the related request read', () => {
  const friends = read('lib/friends.ts')
  const requestRoute = read('app/api/friends/requests/[requestId]/route.ts')

  assert.match(friends, /getFriendRequestNotificationKey\(request\.id\)/)
  assert.match(friends, /key: getFriendRequestNotificationKey\(requestId\)/)
  assert.match(friends, /createdAt: \{ gte: friendRequest\.createdAt \}/)
  assert.match(requestRoute, /getFriendRequestNotificationKey\(requestId\)/)
  assert.doesNotMatch(requestRoute, /where: \{ actorId: user\.id, type: 'FRIEND_REQUEST', link:/)
})

test('open registration no longer blocks on drafts or legacy application rate limits', () => {
  const prepare = read('app/api/auth/register/prepare/route.ts')
  const register = read('app/api/auth/register/route.ts')
  const emailCode = read('app/api/auth/register/send-email-code/route.ts')
  const hospital = read('lib/ehospital-check.ts')

  assert.doesNotMatch(prepare, /REGISTRATION_DRAFT_EXISTS|consumeRateLimit|register:prepare/)
  assert.doesNotMatch(register, /REGISTER_REQUEST_RATE_LIMITED|REGISTER_SUCCESS_RATE_LIMITED|consumeRateLimit|checkRateLimit/)
  assert.doesNotMatch(emailCode, /consumeRateLimit|register:email-code/)
  assert.match(emailCode, /checkDailyRegistrationEmailCodeLimit/)
  assert.match(emailCode, /recordSuccessfulRegistrationEmailCodeSend/)
  assert.match(hospital, /DAILY_LIMIT_REACHED|countAttempts\(/)
  assert.match(hospital, /getShanghaiDayRange/)
  assert.doesNotMatch(register, /EHospitalCheckConfig WHERE id = .*FOR UPDATE/)
  assert.match(register, /withMySqlAdvisoryLocks/)
  assert.match(register, /created\.uid > MAX_UID/)
  assert.match(register, /concurrentDuplicate/)
})

test('registration still requires phone, email verification, hospital pass, and account conflict checks', () => {
  const prepare = read('app/api/auth/register/prepare/route.ts')
  const register = read('app/api/auth/register/route.ts')

  assert.match(prepare, /PHONE_REQUIRED/)
  assert.match(register, /EMAIL_VERIFICATION_REQUIRED/)
  assert.match(register, /HOSPITAL_CHECK_REQUIRED/)
  assert.match(register, /EMAIL_ALREADY_EXISTS/)
  assert.match(register, /PHONE_ALREADY_EXISTS/)
  assert.match(register, /USERNAME_ALREADY_EXISTS/)
})
