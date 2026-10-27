import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CONCERT_DISCUSSION_MAX_IMAGES,
  CONCERT_DISCUSSION_MAX_TEXT_LENGTH,
  concertDiscussionScopeWhere,
  isConcertDiscussionRequestId,
  matchesConcertDiscussionIdempotency,
  normalizeOwnedConcertDiscussionImageUrl,
  parseConcertDiscussionInput,
} from '@/lib/concert-discussion'
import { parseConcertEventInput, ConcertAdminInputError } from '@/lib/concert-admin-input'
import { publicPostWhere } from '@/lib/post-moderation'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const requestId = '55b969f5-8c99-4a1d-b3a8-73a50a03454e'
const imageUrl = (userId: string, id = '46d6f25a-5e82-44e3-9583-d1f7c4aa31ae') => `https://ecfc-1306412725.cos.ap-guangzhou.myqcloud.com/content/${userId}/${id}/source.webp`

test('event-wide and show-specific rooms have distinct, explicit scopes', () => {
  assert.deepEqual(concertDiscussionScopeWhere('event-1', null), { eventId: 'event-1', showId: null })
  assert.deepEqual(concertDiscussionScopeWhere('event-1', 'show-1'), { eventId: 'event-1', showId: 'show-1' })
  assert.notDeepEqual(concertDiscussionScopeWhere('event-1', null), concertDiscussionScopeWhere('event-1', 'show-1'))
})

test('discussion input supports text-only and authenticated-owner COS image comments', () => {
  assert.equal(isConcertDiscussionRequestId(requestId), true)
  assert.deepEqual(parseConcertDiscussionInput({ requestId, content: '今晚讨论这场', imageUrls: [] }, 'user-1'), {
    ok: true,
    value: { requestId, content: '今晚讨论这场', imageUrls: [] },
  })
  assert.deepEqual(parseConcertDiscussionInput({ requestId, content: '', imageUrls: [imageUrl('user-1')] }, 'user-1'), {
    ok: true,
    value: { requestId, content: '', imageUrls: [imageUrl('user-1')] },
  })
})

test('discussion image validation rejects other users, arbitrary hosts, query strings, variants, and malformed UUIDs', () => {
  assert.equal(normalizeOwnedConcertDiscussionImageUrl(imageUrl('user-1'), 'user-2'), null)
  assert.equal(normalizeOwnedConcertDiscussionImageUrl('https://example.com/content/user-1/46d6f25a-5e82-44e3-9583-d1f7c4aa31ae/source.webp', 'user-1'), null)
  assert.equal(normalizeOwnedConcertDiscussionImageUrl(`${imageUrl('user-1')}?token=x`, 'user-1'), null)
  assert.equal(normalizeOwnedConcertDiscussionImageUrl(imageUrl('user-1').replace('/source.webp', '/preview.webp'), 'user-1'), null)
  assert.equal(normalizeOwnedConcertDiscussionImageUrl(imageUrl('user-1', 'not-a-uuid'), 'user-1'), null)
})

test('discussion parser enforces text codepoint, image count, request ID, and nonempty payload limits', () => {
  assert.equal(parseConcertDiscussionInput({ requestId: 'nope', content: 'x' }, 'user-1').ok, false)
  assert.equal(parseConcertDiscussionInput({ requestId, content: '😀'.repeat(CONCERT_DISCUSSION_MAX_TEXT_LENGTH + 1) }, 'user-1').ok, false)
  assert.equal(parseConcertDiscussionInput({ requestId, content: '😀'.repeat(CONCERT_DISCUSSION_MAX_TEXT_LENGTH) }, 'user-1').ok, true)
  assert.equal(parseConcertDiscussionInput({ requestId, content: '', imageUrls: [] }, 'user-1').ok, false)
  assert.equal(parseConcertDiscussionInput({ requestId, content: 'x', imageUrls: Array(CONCERT_DISCUSSION_MAX_IMAGES + 1).fill(imageUrl('user-1')) }, 'user-1').ok, false)
})

test('idempotency accepts only the identical event, show, text, and ordered image payload', () => {
  const existing = { eventId: 'event-1', showId: 'show-1', content: 'text', images: [{ url: imageUrl('user-1') }] }
  const input = { requestId, content: 'text', imageUrls: [imageUrl('user-1')] }
  assert.equal(matchesConcertDiscussionIdempotency(existing, input, 'event-1', 'show-1'), true)
  assert.equal(matchesConcertDiscussionIdempotency(existing, input, 'event-2', 'show-1'), false)
  assert.equal(matchesConcertDiscussionIdempotency(existing, input, 'event-1', null), false)
  assert.equal(matchesConcertDiscussionIdempotency(existing, { ...input, content: 'different' }, 'event-1', 'show-1'), false)
  assert.equal(matchesConcertDiscussionIdempotency(existing, { ...input, imageUrls: [] }, 'event-1', 'show-1'), false)
})

test('concert event background image input is persisted only for project media URLs', () => {
  const base = { title: 'Event', slug: 'event', description: 'Description' }
  assert.equal(parseConcertEventInput({ ...base, backgroundImageUrl: imageUrl('admin-1') }).backgroundImageUrl, imageUrl('admin-1'))
  assert.throws(() => parseConcertEventInput({ ...base, backgroundImageUrl: 'https://example.com/cover.jpg' }), ConcertAdminInputError)
  assert.equal(parseConcertEventInput(base).backgroundImageUrl, undefined)
})

test('public plaza queries exclude legacy event posts while event discussion uses its own tables', () => {
  assert.equal(publicPostWhere.concertShowId, null)
  const schema = read('../prisma/schema.prisma')
  const migration = read('../prisma/migrations/20261027130000_add_concert_discussions_v2/migration.sql')
  assert.match(schema, /model ConcertDiscussionComment/)
  assert.match(schema, /model ConcertDiscussionImage/)
  assert.match(migration, /CREATE TABLE `ConcertDiscussionComment`/)
  assert.match(migration, /CREATE TABLE `ConcertDiscussionImage`/)
  assert.match(migration, /`showId` VARCHAR\(191\) NULL/)
})

test('public discussion API authenticates writes, validates event/show scope, and soft-delete is owner-only', () => {
  const publicRoute = read('../app/api/concert-events/[slug]/discussion/route.ts')
  const ownerDelete = read('../app/api/concert-events/[slug]/discussion/[commentId]/route.ts')
  const legacyCreatePage = read('../app/posts/new/page.tsx')
  const legacyCreateForm = read('../components/PostCreateForm.tsx')
  assert.match(publicRoute, /rejectInvalidRequestOrigin\(request\)/)
  assert.match(publicRoute, /resolveRequestAuth\(request\)/)
  assert.match(publicRoute, /author: publicAuthorWhere/)
  assert.match(publicRoute, /status: 'SCHEDULED'/)
  assert.match(publicRoute, /showId: scope\.showId/)
  assert.match(publicRoute, /enforceApiRateLimit/)
  assert.match(publicRoute, /checkBannedWords/)
  assert.match(publicRoute, /requestId/)
  assert.doesNotMatch(publicRoute, /input\.userId|input\.authorId|body\.eventId/)
  assert.match(ownerDelete, /authorId: auth\.user\.id/)
  assert.match(ownerDelete, /updateMany\([\s\S]*isDeleted: false/)
  assert.match(ownerDelete, /rejectInvalidRequestOrigin\(request\)/)
  assert.match(legacyCreatePage, /redirect\(`\/concerts\/\$\{show\.event\.slug\}\/shows\/\$\{show\.id\}#discussion`\)/)
  assert.doesNotMatch(legacyCreateForm, /concertShowId/)
})

test('admin discussion management is permission-guarded, soft-deletes transactionally, and audits removals', () => {
  const adminRead = read('../app/api/admin/concert-discussions/route.ts')
  const adminDelete = read('../app/api/admin/concert-discussions/[commentId]/route.ts')
  const page = read('../app/admin/concerts/discussions/page.tsx')
  const manager = read('../app/admin/concerts/discussions/ConcertDiscussionAdminManager.tsx')
  assert.match(adminRead, /requireAdmin\('activity_manage', request\)/)
  assert.match(adminRead, /isDeleted: false/)
  assert.match(adminDelete, /requireAdmin\('activity_manage', request\)/)
  assert.match(adminDelete, /prisma\.\$transaction/)
  assert.match(adminDelete, /createAdminActionAudit/)
  assert.match(adminDelete, /isDeleted: true, deletedAt/)
  assert.match(page, /requireAdminPage\([^\n]+activity_manage/)
  assert.match(manager, /确定从公开讨论区移除/)
  assert.match(manager, /处理中…/)
})

test('discussion UI supports image preview, paging, own-comment deletion, login return, and failure feedback', () => {
  const component = read('../components/concerts/ConcertDiscussion.tsx')
  assert.match(component, /window\.confirm/)
  assert.match(component, /DELETE/)
  assert.match(component, /删除中…/)
  assert.match(component, /response\.status === 401/)
  assert.match(component, /加载更多讨论/)
  assert.match(component, /添加图片/)
  assert.match(component, /可预览后提交/)
  assert.match(component, /return=|redirect=/)
})

test('legacy plaza post creation and concertShowId lookup are rejected instead of leaking discussions into feeds', () => {
  const postsApi = read('../app/api/posts/route.ts')
  const feed = read('../lib/post-moderation.ts')
  assert.match(postsApi, /searchParams\.has\('concertShowId'\)[\s\S]*status:\s*410/)
  assert.match(postsApi, /body\.concertShowId[\s\S]*status:\s*410/)
  assert.match(feed, /concertShowId: null/)
})

test('feature limits remain aligned across helper and API', () => {
  assert.equal(CONCERT_DISCUSSION_MAX_TEXT_LENGTH, 3000)
  assert.equal(CONCERT_DISCUSSION_MAX_IMAGES, 4)
})

test('Tencent auto-deploy verifies SSH host identity against the protected fingerprint', () => {
  const deploy = read('../.github/workflows/deploy.yml')
  assert.match(deploy, /environment: Production/)
  assert.match(deploy, /fingerprint: \$\{\{ vars\.PRODUCTION_SSH_HOST_KEY_SHA256 \}\}/)
  assert.match(deploy, /PINNED_HOST_KEY_SHA256: \$\{\{ vars\.PRODUCTION_SSH_HOST_KEY_SHA256 \}\}/)
  assert.match(deploy, /ssh-keygen -lf .* -E sha256/)
  assert.match(deploy, /grep -Fx -- "\$\{PINNED_HOST_KEY_SHA256\}"/)
  assert.doesNotMatch(deploy, /ssh-keyscan[\s\S]{0,180}>> "\$\{HOME\}\/\.ssh\/known_hosts"/)
})

test('homepage and activity center use the persisted featured event image and public activity eligibility', () => {
  const welcomePage = read('../app/welcome/page.tsx')
  const activitiesPage = read('../app/activities/page.tsx')
  const spotlight = read('../components/concerts/RecordingSessionsSpotlight.tsx')
  const adminForm = read('../app/admin/concerts/ConcertEventAdminManager.tsx')
  assert.match(welcomePage, /homepageFeatured: true/)
  assert.match(spotlight, /publicImageUrl\(event\.backgroundImageUrl\)/)
  assert.match(activitiesPage, /activityCenterVisible: true/)
  assert.match(activitiesPage, /ConcertCountdown/)
  assert.match(adminForm, /uploadActivityImage/)
  assert.match(adminForm, /backgroundSelection\.removed/)
})
