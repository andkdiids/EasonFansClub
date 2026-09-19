import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { getShanghaiDateKey } from '@/lib/checkin'
import {
  evaluateProfileBackgroundLikeQuota,
  formatProfileBackgroundLikeNotification,
  PROFILE_BACKGROUND_LIKE_DAILY_LIMIT,
  PROFILE_BACKGROUND_LIKER_PAGE_SIZE,
} from '@/lib/profile-background-likes'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const schema = read('prisma/schema.prisma')
const service = read('lib/profile-background-likes.ts')
const route = read('app/api/users/[userId]/profile-background-like/route.ts')
const listRoute = read('app/api/users/[userId]/profile-background-like/likers/route.ts')
const control = read('components/ProfileBackgroundLikeControl.tsx')
const surface = read('components/ProfilePageSurface.tsx')
const notificationWrite = read('lib/notification-write.ts')
const notifications = read('lib/notifications.ts')
const migration = read('prisma/migrations/20260919120000_add_profile_background_likes/migration.sql')

test('current like is unique per liker and owner, independent from replaceable background URL', () => {
  const model = schema.slice(schema.indexOf('model ProfileBackgroundLike {'), schema.indexOf('model ProfileBackgroundLikeDailyAction {'))
  assert.match(model, /likerId\s+String/u)
  assert.match(model, /profileOwnerId\s+String/u)
  assert.match(model, /@@unique\(\[likerId, profileOwnerId\]/u)
  assert.doesNotMatch(model, /backgroundUrl|imageUrl|COS/u)
  assert.match(model, /onDelete: Cascade/g)
  assert.match(migration, /UNIQUE INDEX `ProfileBgLike_liker_owner_key` \(`likerId`, `profileOwnerId`\)/u)
})

test('POST is idempotent, DELETE removes only the live relation, and relike restores exactly one relation', () => {
  assert.match(route, /export async function POST[\s\S]*mutate\(request, context, true\)/u)
  assert.match(route, /export async function DELETE[\s\S]*mutate\(request, context, false\)/u)
  assert.match(service, /if \(existing\) \{[\s\S]*changed: false,[\s\S]*liked: true/u)
  assert.match(service, /profileBackgroundLike\.delete\(\{ where: \{ id: existing\.id \} \}\)/u)
  assert.match(service, /profileBackgroundLike\.create\(/u)
  assert.doesNotMatch(service, /profileBackgroundLikeDailyAction\.delete/u)
})

test('self-like and missing-background likes are rejected on the server', () => {
  assert.match(service, /input\.likerId === input\.profileOwnerId/u)
  assert.match(service, /SELF_LIKE_NOT_ALLOWED/u)
  assert.match(service, /if \(!ownerHasBackground\(owner\)\)/u)
  assert.match(service, /PROFILE_BACKGROUND_REQUIRED/u)
  assert.match(surface, /backgroundLikeControl=\{profile\.backgroundUrl \? \(/u)
  assert.match(control, /canToggle = hasViewer && canInteract && !isSelf/u)
})

test('daily quota is ten distinct owners and a previously counted owner can be reliked', () => {
  assert.equal(PROFILE_BACKGROUND_LIKE_DAILY_LIMIT, 10)
  assert.deepEqual(
    evaluateProfileBackgroundLikeQuota({ targetAlreadyCountedToday: false, todayUsed: 9 }),
    { allowed: true, consumesQuota: true },
  )
  assert.deepEqual(
    evaluateProfileBackgroundLikeQuota({ targetAlreadyCountedToday: false, todayUsed: 10 }),
    { allowed: false, consumesQuota: false },
  )
  assert.deepEqual(
    evaluateProfileBackgroundLikeQuota({ targetAlreadyCountedToday: true, todayUsed: 10 }),
    { allowed: true, consumesQuota: false },
  )
  assert.match(schema, /@@unique\(\[likerId, profileOwnerId, businessDate\]/u)
})

test('Shanghai business day resets quota without touching the long-lived like relation', () => {
  assert.equal(getShanghaiDateKey(new Date('2026-09-19T15:59:59.000Z')), '2026-09-19')
  assert.equal(getShanghaiDateKey(new Date('2026-09-19T16:00:00.000Z')), '2026-09-20')
  assert.match(service, /const businessDate = getShanghaiDateKey\(now\)/u)
  assert.doesNotMatch(service, /deleteMany\(\{\s*where: \{[^}]*businessDate/u)
})

test('background replacement and temporary removal preserve historical relationships', () => {
  assert.doesNotMatch(service, /backgroundUrl[^\n]*(delete|deleteMany|updateMany)/u)
  assert.doesNotMatch(read('app/profile/ProfileSettingsForm.tsx'), /profileBackgroundLike/u)
  assert.match(surface, /profile\.backgroundUrl \? \([\s\S]*ProfileBackgroundLikeControl/u)
})

test('aggregate notification copy uses newest actors and the current active count', () => {
  assert.equal(formatProfileBackgroundLikeNotification(['小明'], 1), '小明赞了你的主页背景')
  assert.equal(formatProfileBackgroundLikeNotification(['小红', '小明'], 2), '小红、小明赞了你的主页背景')
  assert.equal(formatProfileBackgroundLikeNotification(['小红', '小明'], 5), '小红、小明等 5 人赞了你的主页背景')
  assert.equal(formatProfileBackgroundLikeNotification([], 0), '')
  assert.match(service, /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/u)
  assert.match(service, /take: 2/u)
})

test('one aggregate notification per owner becomes unread on a new like and is removed at zero', () => {
  assert.match(schema, /@@unique\(\[recipientId, key\]\)/u)
  assert.match(service, /PROFILE_BACKGROUND_LIKE_NOTIFICATION_KEY = 'profile-background-like'/u)
  assert.match(service, /type: 'PROFILE_BACKGROUND_LIKE'/u)
  assert.match(service, /aggregateCount: count/u)
  assert.match(service, /isRead: false,[\s\S]*readAt: null,[\s\S]*createdAt: now/u)
  assert.match(service, /if \(count === 0\) \{[\s\S]*notification\.deleteMany/u)
  assert.match(service, /if \(!markUnread\)[\s\S]*notification\.update/u)
  assert.match(notificationWrite, /NotificationType\.PROFILE_BACKGROUND_LIKE/u)
  assert.match(notifications, /type === 'LIKE' \|\| type === 'PROFILE_BACKGROUND_LIKE'/u)
})

test('quota and owner aggregation are locked in deterministic order before writes', () => {
  const lock = service.indexOf('FOR UPDATE')
  const count = service.indexOf('const todayUsed = await loadTodayUsed', lock)
  const actionInsert = service.indexOf('profileBackgroundLikeDailyAction.create', lock)
  const likeInsert = service.indexOf('profileBackgroundLike.create', lock)
  assert.ok(lock >= 0)
  assert.match(service, /WHERE \\`id\\` IN \(\$\{input\.likerId\}, \$\{input\.profileOwnerId\}\)/u)
  assert.match(service, /ORDER BY \\`id\\` ASC[\s\S]*FOR UPDATE/u)
  assert.ok(count > lock)
  assert.ok(actionInsert > count)
  assert.ok(likeInsert > actionInsert)
  assert.match(migration, /ProfileBgLikeDaily_liker_owner_date_key/u)
})

test('liker list is lazy, paginated at twenty, active-only, and newest first', () => {
  assert.equal(PROFILE_BACKGROUND_LIKER_PAGE_SIZE, 20)
  assert.match(listRoute, /PROFILE_BACKGROUND_LIKER_PAGE_SIZE/u)
  assert.match(service, /Liker: activeLikerWhere/u)
  assert.match(service, /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/u)
  assert.match(service, /skip: \(page - 1\) \* pageSize/u)
  assert.match(service, /take: pageSize/u)
  assert.match(control, /loadLikers\(listPage \+ 1, true\)/u)
  assert.match(control, /item\.profileUrl/u)
})

test('optimistic UI locks duplicate requests and rolls count back after an API failure', () => {
  assert.match(control, /if \(busy \|\| !canInteract \|\| isSelf \|\| !hasViewer\) return/u)
  assert.match(control, /disabled=\{busy\}/u)
  assert.match(control, /const previousLiked = liked/u)
  assert.match(control, /const previousCount = count/u)
  assert.match(control, /setLiked\(previousLiked\)/u)
  assert.match(control, /setCount\(previousCount\)/u)
})

test('profile-background likes stay isolated from post-like growth tasks', () => {
  assert.doesNotMatch(service, /completeTask|POST_LIKE|DailyTaskProgress|GrowthTask/u)
  assert.doesNotMatch(route, /completeTask|POST_LIKE|DailyTaskProgress|GrowthTask/u)
})
