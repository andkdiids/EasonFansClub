import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  formatDateTimeLocalInZone,
  getMinimumScheduledPostLocal,
  getPostPublicationLabel,
  getScheduledPostDateBounds,
  getScheduledPostValidationError,
  getScheduledPostValidationMessage,
  isApprovedScheduledPostDue,
  isCancellableApprovedSchedule,
  isScheduledPostTimeValid,
  parseDateTimeLocalInZone,
  parseScheduledPublishAt,
  POST_SCHEDULE_MINIMUM_LEAD_TIME_MS,
  shouldPublishPostOnApproval,
} from '../lib/post-scheduling'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

test('minimum schedule lead time accepts the exact 30 minute boundary only', () => {
  const now = new Date('2026-11-05T00:00:00.000Z')
  assert.equal(isScheduledPostTimeValid(new Date(now.getTime() + POST_SCHEDULE_MINIMUM_LEAD_TIME_MS), now), true)
  assert.equal(isScheduledPostTimeValid(new Date(now.getTime() + POST_SCHEDULE_MINIMUM_LEAD_TIME_MS - 1), now), false)
})

test('schedule calendar-date permissions allow ordinary users today and admins through tomorrow only', () => {
  const now = new Date('2026-11-05T12:00:00.000Z')
  const sameDay = parseDateTimeLocalInZone('2026-11-05T21:00')!
  const nextDay = parseDateTimeLocalInZone('2026-11-06T00:30')!
  const thirdDay = parseDateTimeLocalInZone('2026-11-07T12:00')!

  assert.equal(getScheduledPostValidationError(sameDay, false, now), null)
  assert.equal(getScheduledPostValidationError(nextDay, false, now), 'SCHEDULE_NEXT_DAY_FORBIDDEN')
  assert.equal(getScheduledPostValidationMessage('SCHEDULE_NEXT_DAY_FORBIDDEN'), '普通用户只能预约北京时间当天')
  assert.equal(getScheduledPostValidationError(sameDay, true, now), null)
  assert.equal(getScheduledPostValidationError(nextDay, true, now), null)
  assert.equal(getScheduledPostValidationError(thirdDay, true, now), 'SCHEDULE_DATE_TOO_FAR')
  assert.deepEqual(getScheduledPostDateBounds(now, false), { today: '2026-11-05', maxDate: '2026-11-05' })
  assert.deepEqual(getScheduledPostDateBounds(now, true), { today: '2026-11-05', maxDate: '2026-11-06' })
})

test('23:29, 23:30, and 23:31 scheduling honors minute precision, next-day permission, and the lead time', () => {
  const at2329 = parseDateTimeLocalInZone('2026-11-05T23:29')!
  const at2330 = parseDateTimeLocalInZone('2026-11-05T23:30')!
  const at2331 = parseDateTimeLocalInZone('2026-11-05T23:31')!
  const today2359 = parseDateTimeLocalInZone('2026-11-05T23:59')!
  const tomorrow0000 = parseDateTimeLocalInZone('2026-11-06T00:00')!
  const tomorrow0001 = parseDateTimeLocalInZone('2026-11-06T00:01')!

  assert.equal(getScheduledPostValidationError(today2359, false, at2329), null)
  assert.equal(getScheduledPostValidationError(today2359, false, at2330), 'SCHEDULE_TOO_SOON')
  assert.equal(getScheduledPostValidationError(today2359, false, at2331), 'SCHEDULE_TOO_SOON')
  assert.equal(getScheduledPostValidationError(tomorrow0000, false, at2329), 'SCHEDULE_NEXT_DAY_FORBIDDEN')
  assert.equal(getScheduledPostValidationError(tomorrow0000, true, at2329), null)
  assert.equal(getScheduledPostValidationError(tomorrow0000, true, at2330), null)
  assert.equal(getScheduledPostValidationError(tomorrow0000, true, at2331), 'SCHEDULE_TOO_SOON')
  assert.equal(getScheduledPostValidationError(tomorrow0001, true, at2331), null)
  assert.equal(getMinimumScheduledPostLocal(at2330), '2026-11-06T00:00')
})

test('Shanghai date bounds roll over at Beijing midnight and UTC serialization preserves the authorized wall date', () => {
  const beforeMidnight = new Date('2026-11-05T15:59:59.000Z')
  const afterMidnight = new Date('2026-11-05T16:00:00.000Z')
  assert.deepEqual(getScheduledPostDateBounds(beforeMidnight, false), { today: '2026-11-05', maxDate: '2026-11-05' })
  assert.deepEqual(getScheduledPostDateBounds(afterMidnight, false), { today: '2026-11-06', maxDate: '2026-11-06' })

  const tomorrowLocal = parseDateTimeLocalInZone('2026-11-06T00:30')!
  assert.equal(tomorrowLocal.toISOString(), '2026-11-05T16:30:00.000Z')
  const apiValue = parseScheduledPublishAt(tomorrowLocal.toISOString())!
  assert.equal(getScheduledPostValidationError(apiValue, false, beforeMidnight), 'SCHEDULE_NEXT_DAY_FORBIDDEN')
  assert.equal(getScheduledPostValidationError(apiValue, true, beforeMidnight), null)
})

test('Shanghai datetime-local values preserve arbitrary minutes and map to UTC', () => {
  const local = '2026-11-05T14:37'
  const parsed = parseDateTimeLocalInZone(local)
  assert.ok(parsed)
  assert.equal(parsed.toISOString(), '2026-11-05T06:37:00.000Z')
  assert.equal(formatDateTimeLocalInZone(parsed), local)
  assert.equal(parseDateTimeLocalInZone('2026-02-30T14:37'), null)
})

test('zoned datetime parsing handles daylight-saving gaps and repeated minutes deterministically', () => {
  assert.equal(parseDateTimeLocalInZone('2026-03-08T02:30', 'America/New_York'), null)
  const repeated = parseDateTimeLocalInZone('2026-11-01T01:30', 'America/New_York')
  assert.ok(repeated)
  assert.equal(repeated.toISOString(), '2026-11-01T05:30:00.000Z')
  assert.equal(formatDateTimeLocalInZone(repeated, 'America/New_York'), '2026-11-01T01:30')
})

test('API schedule timestamps require explicit, valid UTC offsets', () => {
  assert.equal(parseScheduledPublishAt('2026-11-05T06:37:00.000Z')?.toISOString(), '2026-11-05T06:37:00.000Z')
  assert.equal(parseScheduledPublishAt('2026-11-05T14:37:00+08:00')?.toISOString(), '2026-11-05T06:37:00.000Z')
  assert.equal(parseScheduledPublishAt('2026-11-05T14:37:00'), null)
  assert.equal(parseScheduledPublishAt('2026-02-30T14:37:00+08:00'), null)
})

test('approval publishes immediately only after the scheduled instant', () => {
  const now = new Date('2026-11-05T06:37:00.000Z')
  assert.equal(shouldPublishPostOnApproval({ publicationStatus: 'SCHEDULED', scheduledPublishAt: new Date(now.getTime() + 60_000), now }), false)
  assert.equal(shouldPublishPostOnApproval({ publicationStatus: 'SCHEDULED', scheduledPublishAt: now, now }), true)
  assert.equal(shouldPublishPostOnApproval({ publicationStatus: 'WAITING_REVIEW', scheduledPublishAt: null, now }), true)
})

test('only approved due schedules can be promoted or cancelled', () => {
  const due = {
    isDeleted: false,
    status: 'DRAFT',
    moderationStatus: 'APPROVED',
    publicationStatus: 'SCHEDULED',
    scheduledPublishAt: new Date('2026-11-05T06:37:00.000Z'),
  }
  const now = new Date('2026-11-05T06:37:00.000Z')
  assert.equal(isApprovedScheduledPostDue(due, now), true)
  assert.equal(isApprovedScheduledPostDue({ ...due, moderationStatus: 'REJECTED' }, now), false)
  assert.equal(isApprovedScheduledPostDue({ ...due, moderationStatus: 'PENDING' }, now), false)
  assert.equal(isCancellableApprovedSchedule(due), true)
  assert.equal(isCancellableApprovedSchedule({ ...due, status: 'PUBLISHED' }), false)
  assert.equal(isCancellableApprovedSchedule({ ...due, publicationStatus: 'CANCELLED' }), false)
})

test('review labels distinguish pending, scheduled, published, rejected and cancelled', () => {
  const states = [
    [{ moderationStatus: 'PENDING', publicationStatus: 'WAITING_REVIEW' }, '待审核'],
    [{ moderationStatus: 'APPROVED', publicationStatus: 'SCHEDULED' }, '审核通过，等待定时发布'],
    [{ moderationStatus: 'APPROVED', publicationStatus: 'PUBLISHED' }, '已发布'],
    [{ moderationStatus: 'REJECTED', publicationStatus: 'SCHEDULED' }, '审核拒绝'],
    [{ moderationStatus: 'APPROVED', publicationStatus: 'CANCELLED' }, '已取消'],
  ] as const
  for (const [input, expected] of states) assert.equal(getPostPublicationLabel(input), expected)
})

test('public post filters fail closed until publicationStatus and publishedAt are set', () => {
  const moderation = read('lib/post-moderation.ts')
  const postList = read('app/api/posts/route.ts')
  const profileModules = read('app/api/users/[userId]/public-modules/route.ts')
  const detailApi = read('app/api/posts/[postId]/route.ts')
  assert.match(moderation, /publicationStatus:\s*'PUBLISHED'/)
  assert.match(moderation, /publishedAt:\s*\{\s*not:\s*null\s*\}/)
  assert.match(postList, /buildPublicPostWhere as publicPostWhere/)
  assert.match(profileModules, /buildProfilePostWhere\(target\.id, canViewPendingPosts\)/)
  assert.match(detailApi, /publicationStatus:\s*'PUBLISHED'[\s\S]{0,100}publishedAt:\s*\{\s*not:\s*null\s*\}/)
})

test('publication and cancellation use database locks and conditional state changes', () => {
  const publisher = read('lib/post-publication.ts')
  const applyEffects = publisher.slice(publisher.indexOf('async function applyPublicationDatabaseEffects'), publisher.indexOf('async function finishPublicationEvent'))
  const cancel = read('app/api/posts/[postId]/schedule/route.ts')
  assert.match(publisher, /SELECT \\\x60id\\\x60 FROM \\\x60Post\\\x60 WHERE \\\x60id\\\x60 = \$\{postId\} FOR UPDATE/)
  assert.match(publisher, /moderationStatus:\s*'APPROVED'[\s\S]{0,120}publicationStatus:\s*'SCHEDULED'/)
  assert.match(publisher, /const updated = await tx\.post\.updateMany/)
  assert.match(publisher, /lockToken, lastError: null, attempts: \{ increment: 1 \}/)
  assert.match(applyEffects, /const eventSnapshot = await prisma\.postPublicationEvent\.findUnique/)
  const userRewardLock = applyEffects.indexOf('FROM \\`User\\` WHERE \\`id\\` = ${lockedPost.authorId} FOR UPDATE')
  assert.ok(userRewardLock >= 0)
  assert.ok(userRewardLock < applyEffects.indexOf('const event = await tx.postPublicationEvent.findFirst'))
  assert.ok(userRewardLock < applyEffects.indexOf('recordQualifiedPublishedPostGrowth(tx'))
  const postLock = applyEffects.indexOf('SELECT \\`id\\`, \\`authorId\\` FROM \\`Post\\`')
  assert.ok(postLock >= 0 && postLock < applyEffects.indexOf('SELECT \\`id\\` FROM \\`PostPublicationEvent\\`'))
  assert.match(cancel, /SELECT \\\x60id\\\x60 FROM \\\x60Post\\\x60 WHERE \\\x60id\\\x60 = \$\{postId\} FOR UPDATE/)
  assert.match(cancel, /publicationStatus:\s*'SCHEDULED'[\s\S]{0,100}data:\s*\{ publicationStatus: 'CANCELLED' \}/)
  assert.match(cancel, /status: 'WAITING'[\s\S]{0,120}status: 'CANCELLED'/)
})

test('outbox retries failures and migration preserves legacy published rows', () => {
  const publisher = read('lib/post-publication.ts')
  const migration = read('prisma/migrations/20261105120000_add_scheduled_post_publication/migration.sql')
  assert.match(publisher, /availableAt: new Date\(now\.getTime\(\) \+ retryDelayMs\(attempts\)\)/)
  assert.match(publisher, /\[post-publication\.event\.failed\]/)
  assert.match(publisher, /post-publication-failure:/)
  assert.match(migration, /publicationStatus` ENUM[\s\S]{0,120}DEFAULT 'PUBLISHED'/)
  assert.match(migration, /MODIFY COLUMN `publishedAt` DATETIME\(3\) NULL/)
  assert.match(migration, /UNIQUE INDEX `PostPublicationEvent_postId_key`/)
  assert.doesNotMatch(migration, /\bUPDATE\s+`?Post`?/i)
})

test('publication side effects are tied to the unique durable event', () => {
  const publisher = read('lib/post-publication.ts')
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /postId\s+String\s+@unique/)
  assert.match(publisher, /recordQualifiedPublishedPostGrowth\(tx/)
  assert.match(publisher, /const notificationKey = `post-published:\$\{post\.id\}`/)
  assert.match(publisher, /where: \{ id: eventId, status: 'PROCESSING', lockToken \}/)
  assert.match(publisher, /status: 'COMPLETED'/)
})

test('publication event claims use fresh lease time and renew without overlapping heartbeat requests', () => {
  const publisher = read('lib/post-publication.ts')
  assert.match(publisher, /const claimedAt = new Date\(\)/)
  assert.match(publisher, /lockedAt: claimedAt/)
  assert.match(publisher, /const renew = async \(\) => \{[\s\S]*await prisma\.postPublicationEvent\.updateMany\([\s\S]*lockedAt: new Date\(\)/)
  assert.match(publisher, /timer = setTimeout\(\(\) => void renew\(\), PUBLICATION_EVENT_HEARTBEAT_MS\)/)
  assert.match(publisher, /finally \{[\s\S]*stopHeartbeat\(\)/)
})

test('scheduled publication batches are capped, bounded, grouped per author and defer before the cron timeout', () => {
  const publisher = read('lib/post-publication.ts')
  assert.match(publisher, /MAX_PUBLICATION_BATCH_SIZE = 100/)
  assert.match(publisher, /MAX_PUBLICATION_BATCH_CONCURRENCY = 6/)
  assert.match(publisher, /MAX_PUBLICATION_JOB_WORK_MS = 35_000/)
  assert.match(publisher, /const eventsByAuthor = new Map<string, typeof pendingEvents>\(\)/)
  assert.match(publisher, /const authorId = event\.Post\.authorId/)
  assert.match(publisher, /eventsDeferred \+= authorEvents\.length - index/)
  assert.match(publisher, /eventsDeferred,/)
  assert.equal((publisher.match(/mapWithConcurrency\(/g) || []).length, 2)
})
test('owner edits requeue publication effects for re-review and cannot reopen a cancelled schedule', () => {
  const editRoute = read('app/api/posts/[postId]/route.ts')
  const postDetail = read('app/posts/[postId]/page.tsx')
  const reviewRoute = read('app/api/admin/posts/review/route.ts')
  assert.match(editRoute, /lockedExisting\.publicationStatus === 'CANCELLED'/)
  assert.match(editRoute, /tx\.postPublicationEvent\.updateMany\([\s\S]*status: \{ not: 'WAITING' \}[\s\S]*status: 'WAITING'[\s\S]*lockToken: null[\s\S]*completedAt: null/)
  assert.match(editRoute, /POST_SCHEDULE_CANCELLED/)
  assert.match(postDetail, /post\.publicationStatus !== 'CANCELLED'/)
  assert.match(reviewRoute, /publicationEvent\.status === 'WAITING'/)
})

test('the server derives next-day access from post_manage and the form refreshes Shanghai date limits', () => {
  const postApi = read('app/api/posts/route.ts')
  const createPage = read('app/posts/new/page.tsx')
  const createForm = read('components/PostCreateForm.tsx')
  assert.match(postApi, /publishMode === 'SCHEDULED' && await hasAdminPermission\(user, 'post_manage'\)/)
  assert.match(postApi, /getScheduledPostValidationError\(requestedSchedule, canScheduleNextDay, createdAt\)/)
  assert.match(postApi, /status: scheduleError === 'SCHEDULE_NEXT_DAY_FORBIDDEN' \? 403 : 400/)
  assert.doesNotMatch(postApi, /body\.(?:isAdmin|role|canScheduleNextDay)/)
  assert.match(createPage, /canScheduleNextDay=\{canPostAnnouncement\}/)
  assert.match(createForm, /max=\{maximumScheduledLocal\}/)
  assert.match(createForm, /setInterval\(\(\) => setScheduleNow\(new Date\(\)\), 15_000\)/)
  assert.match(createForm, /getScheduledPostValidationError\(scheduledPublishAt, canScheduleNextDay, new Date\(\)\)/)
})


test('scheduled cancellation is author-only, including for users with post management permissions', () => {
  const cancel = read('app/api/posts/[postId]/schedule/route.ts')
  assert.match(cancel, /if \(post\.authorId !== guard\.user\.id\) throw new Error\('POST_CANCEL_FORBIDDEN'\)/)
  assert.doesNotMatch(cancel, /hasAdminPermission/)
  assert.doesNotMatch(cancel, /canManagePosts/)
})
