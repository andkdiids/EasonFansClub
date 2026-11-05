import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  formatDateTimeLocalInZone,
  getPostPublicationLabel,
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

test('Shanghai datetime-local values preserve arbitrary minutes and map to UTC', () => {
  const local = '2026-11-05T14:37'
  const parsed = parseDateTimeLocalInZone(local)
  assert.ok(parsed)
  assert.equal(parsed.toISOString(), '2026-11-05T06:37:00.000Z')
  assert.equal(formatDateTimeLocalInZone(parsed), local)
  assert.equal(parseDateTimeLocalInZone('2026-02-30T14:37'), null)
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
  assert.ok(applyEffects.indexOf('SELECT \\`id\\` FROM \\`Post\\`') < applyEffects.indexOf('SELECT \\`id\\` FROM \\`PostPublicationEvent\\`'))
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
