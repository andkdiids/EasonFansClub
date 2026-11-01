import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildInstagramMediaStorageKey, ANYWHERE_DOOR_TARGET } from '@/lib/anywhere-door/config'
import { buildManualPostMediaRecords, createManualPostMediaReceipt, verifyManualPostMediaReceipt } from '@/lib/anywhere-door/manual-media'
import { isManualPostImageMimeType, MANUAL_POST_MAX_MEDIA, MANUAL_POST_MAX_VIDEO_BYTES } from '@/lib/anywhere-door/manual-media-policy'
import {
  buildInstagramPostIdentityFilters,
  buildManualSocialPostExternalId,
  canonicalizeInstagramSourceUrl,
  resolveManualSocialPostMediaType,
} from '@/lib/instagram/source-identity'
import { safeSyncErrorCode, safeSyncErrorMessage } from '@/lib/instagram/safe-sync-status'

const root = process.cwd()
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

function matchesIdentity(row: Record<string, unknown>, filters: object[]) {
  return filters.some((filter) => Object.entries(filter).every(([key, value]) => row[key] === value))
}

test('manual content classification maps text, single media, and ordered multi-media to existing post types', () => {
  assert.equal(resolveManualSocialPostMediaType(true, []), 'TEXT')
  assert.equal(resolveManualSocialPostMediaType(false, ['IMAGE']), 'IMAGE')
  assert.equal(resolveManualSocialPostMediaType(true, ['IMAGE']), 'IMAGE')
  assert.equal(resolveManualSocialPostMediaType(false, ['VIDEO']), 'VIDEO')
  assert.equal(resolveManualSocialPostMediaType(true, ['VIDEO']), 'VIDEO')
  assert.equal(resolveManualSocialPostMediaType(false, ['IMAGE', 'IMAGE', 'IMAGE']), 'CAROUSEL')
  assert.equal(resolveManualSocialPostMediaType(false, ['IMAGE', 'VIDEO', 'IMAGE']), 'CAROUSEL')
  assert.equal(resolveManualSocialPostMediaType(false, ['VIDEO', 'VIDEO']), 'CAROUSEL')
  assert.equal(resolveManualSocialPostMediaType(false, []), null)
})

test('manual mixed media receipts are signed, admin-bound, expiring, and restricted to Anywhere Door media keys', () => {
  const oldSecret = process.env.JWT_SECRET
  process.env.JWT_SECRET = 'unit-test-anywhere-door-media-signing-secret'
  const now = Date.parse('2026-11-02T02:00:00.000Z')
  try {
    const uploadId = randomUUID()
    const key = buildInstagramMediaStorageKey({ username: ANYWHERE_DOOR_TARGET, mode: 'production', externalId: `manual:${uploadId}`, kind: 'image', sortOrder: 0 })
    const receipt = createManualPostMediaReceipt({ uploadId, userId: 'admin-1', key, type: 'IMAGE', sha256: 'a'.repeat(64), size: 1024 }, now)
    assert.equal(verifyManualPostMediaReceipt(receipt.token, 'admin-1', now)?.uploadId, uploadId)
    assert.equal(verifyManualPostMediaReceipt(receipt.token, 'admin-2', now), null)
    assert.equal(verifyManualPostMediaReceipt(`${receipt.token}x`, 'admin-1', now), null)
    assert.equal(verifyManualPostMediaReceipt(receipt.token, 'admin-1', now + 2 * 60 * 60 * 1000), null)
    assert.equal(verifyManualPostMediaReceipt(receipt.token, 'admin-1', now + 2 * 60 * 60 * 1000, { allowExpiredForCleanup: true })?.uploadId, uploadId)
    assert.throws(() => createManualPostMediaReceipt({ uploadId: randomUUID(), userId: 'admin-1', key: 'social/instagram/mreasonchan/other/video-01.mp4', type: 'IMAGE', sha256: 'b'.repeat(64), size: 1 }, now), /MANUAL_MEDIA_RECEIPT_INVALID/)
  } finally {
    if (oldSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = oldSecret
  }
})

test('manual upload policy allows only JPG, PNG, WebP and MP4 with bounded carousel count and video size', () => {
  assert.equal(isManualPostImageMimeType('image/jpeg'), true)
  assert.equal(isManualPostImageMimeType('image/png'), true)
  assert.equal(isManualPostImageMimeType('image/webp'), true)
  assert.equal(isManualPostImageMimeType('image/gif'), false)
  assert.equal(MANUAL_POST_MAX_MEDIA, 10)
  assert.equal(MANUAL_POST_MAX_VIDEO_BYTES, 50 * 1024 * 1024)
})

test('mixed media child records retain exact selection order within one carousel', () => {
  const records = buildManualPostMediaRecords([
    { type: 'IMAGE', key: 'image-1' },
    { type: 'VIDEO', key: 'video-1' },
    { type: 'IMAGE', key: 'image-2' },
  ], (key) => `https://cos.example/${key}`)
  assert.deepEqual(records, [
    { type: 'IMAGE', storageUrl: 'https://cos.example/image-1', thumbnailUrl: null, sortOrder: 0 },
    { type: 'VIDEO', storageUrl: 'https://cos.example/video-1', thumbnailUrl: null, sortOrder: 1 },
    { type: 'IMAGE', storageUrl: 'https://cos.example/image-2', thumbnailUrl: null, sortOrder: 2 },
  ])
})

test('manual source URLs are canonicalized and reject non-Instagram or credential-bearing URLs', () => {
  assert.deepEqual(canonicalizeInstagramSourceUrl('https://m.instagram.com/reel/AbC_12/?igsh=private'), {
    permalink: 'https://www.instagram.com/reel/AbC_12/', shortcode: 'AbC_12',
  })
  for (const value of [
    'http://www.instagram.com/p/AbC_12/',
    'https://example.com/p/AbC_12/',
    'https://user:pass@www.instagram.com/p/AbC_12/',
    'https://www.instagram.com/accounts/login/',
  ]) assert.deepEqual(canonicalizeInstagramSourceUrl(value), { permalink: null, shortcode: null })
})

test('AUTO to MANUAL dedupe uses exact shortcode/permalink identity, not caption similarity', () => {
  const manualSource = canonicalizeInstagramSourceUrl('https://instagram.com/p/ExactShortcode/?tracking=1')
  const manualId = buildManualSocialPostExternalId({
    ...manualSource, caption: 'caption', publishedAt: new Date('2026-10-17T10:00:00.000Z'), mediaType: 'TEXT', mediaSha256: null,
  })
  const manualFilters = buildInstagramPostIdentityFilters({
    externalId: manualId, ...manualSource, authorUsername: 'mreasonchan',
  })
  const automaticPost = {
    externalId: 'apify-provider-id', shortcode: 'ExactShortcode', permalink: 'https://www.instagram.com/p/ExactShortcode/', authorUsername: 'mreasonchan', caption: 'a different caption',
  }
  assert.equal(matchesIdentity(automaticPost, manualFilters), true)
  assert.equal(matchesIdentity({ ...automaticPost, shortcode: 'OtherShortcode', permalink: 'https://www.instagram.com/p/OtherShortcode/' }, manualFilters), false)
  assert.equal(matchesIdentity({ ...automaticPost, authorUsername: 'someone-else' }, manualFilters), false)
})

test('MANUAL to AUTO dedupe retains the manual record when the crawler later sees the same source', () => {
  const source = canonicalizeInstagramSourceUrl('https://www.instagram.com/tv/SharedSourceId/')
  const automaticFilters = buildInstagramPostIdentityFilters({
    externalId: 'provider-external-id', ...source, authorUsername: 'mreasonchan',
  })
  const manualPost = {
    externalId: 'manual:deterministic-id', shortcode: source.shortcode, permalink: source.permalink, authorUsername: 'mreasonchan', provider: 'manual', caption: 'admin-preserved source text',
  }
  assert.equal(matchesIdentity(manualPost, automaticFilters), true)
  const sync = read('lib/instagram/sync-service.ts')
  assert.match(sync, /existing\?\.provider === 'manual'/)
  assert.match(sync, /return \{ id: existing\.id, created: false/)
})

test('manual IDs are deterministic for exact source identity and exact content fallback', () => {
  const sourceA = canonicalizeInstagramSourceUrl('https://www.instagram.com/p/StableSource/')
  const sourceB = canonicalizeInstagramSourceUrl('https://m.instagram.com/p/StableSource/?tracking=2')
  const base = { caption: 'original body', publishedAt: new Date('2026-10-17T10:00:00.000Z'), mediaType: 'VIDEO' as const, mediaSha256: 'abc123' }
  assert.equal(buildManualSocialPostExternalId({ ...sourceA, ...base }), buildManualSocialPostExternalId({ ...sourceB, ...base }))
  assert.notEqual(buildManualSocialPostExternalId({ permalink: null, shortcode: null, ...base }), buildManualSocialPostExternalId({ permalink: null, shortcode: null, ...base, mediaSha256: 'different' }))
})

test('manual import is admin-only, rate-limited, leased, transactional, and audited without public admin identity', () => {
  const route = read('app/api/admin/anywhere-door/posts/manual/route.ts')
  assert.match(route, /rejectInvalidRequestOrigin\(request\)/)
  assert.match(route, /requireAdmin\('social_manage'\)/)
  assert.match(route, /enforceApiRateLimit\(/)
  assert.match(route, /acquireInstagramSyncLease\(/)
  assert.match(route, /releaseInstagramSyncLease\(/)
  assert.match(route, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(route, /createAdminActionAudit\(tx/)
  assert.match(route, /authorUsername: ANYWHERE_DOOR_TARGET/)
  assert.match(route, /deleteFromCos\(/)
  assert.match(route, /mediaReceipts/)
  assert.match(route, /resolveManualSocialPostMediaType\(Boolean\(caption\), receipts\.map\(\(receipt\) => receipt\.type\)\)/)
  assert.match(route, /create: buildManualPostMediaRecords\(receipts, getCosUrl\)/)
  assert.match(route, /authorUsername: ANYWHERE_DOOR_TARGET/)
  assert.doesNotMatch(route, /form\.get\(['"](?:userId|authorUsername|provider)['"]\)/)

  const upload = read('app/api/admin/anywhere-door/posts/manual/media/route.ts')
  assert.match(upload, /requireAdmin\('social_manage'\)/)
  assert.match(upload, /rejectInvalidRequestOrigin\(request\)/)
  assert.match(upload, /uploadToCos\(/)
  assert.match(upload, /sharp\(/)
  assert.match(upload, /isMp4\(/)
  assert.match(upload, /verifyManualPostMediaReceipt\(body\?\.receipt, guard\.user\.id, Date\.now\(\), \{ allowExpiredForCleanup: true \}\)/)
  assert.match(upload, /if \(referenced\) return NextResponse\.json/)

  const posts = read('lib/social-posts.ts')
  const serializeBody = posts.slice(posts.indexOf('function serializePost('), posts.indexOf('export async function getPublicSocialPostFeed('))
  assert.match(serializeBody, /authorUsername: row\.authorUsername/)
  assert.doesNotMatch(serializeBody, /provider:|operatorName:|adminId:/)
  assert.match(posts, /operationType: \{ in: \['ANYWHERE_DOOR_MANUAL_POST_CREATED', 'ANYWHERE_DOOR_MANUAL_POST_DEDUPED'\]/)

  const form = read('app/admin/anywhere-door/ManualPostForm.tsx')
  assert.match(form, /if \(busy\) return/)
  assert.match(form, /multiple onChange=\{addFiles\}/)
  assert.match(form, /图片 \/ 视频（可选）/)
  assert.match(form, /state: 'uploading'/)
  assert.match(form, /state: 'failed'/)
  assert.match(form, /重试/)
  assert.match(form, /移除/)
  assert.match(form, /currentMedia\.map\(\(item\) => item\.receipt\)/)
  assert.ok(form.indexOf('if (!response.ok) throw') < form.indexOf('formRef.current?.reset()'))
  assert.match(form, /内容已保存，但列表刷新失败/)
  assert.match(form, /setError\(caught instanceof Error/)
})

test('manual media is written as one post with ordered IMAGE and VIDEO children and public carousel reads that order', () => {
  const route = read('app/api/admin/anywhere-door/posts/manual/route.ts')
  assert.equal((route.match(/tx\.socialPost\.create\(/g) || []).length, 1)
  assert.match(route, /media: \{\s*create: buildManualPostMediaRecords\(receipts, getCosUrl\)/)
  const persistence = read('lib/anywhere-door/manual-media.ts')
  assert.match(persistence, /receipts\.map\(\(receipt, sortOrder\) => \(\{\s*type: receipt\.type,[\s\S]*?sortOrder,/)
  assert.match(route, /mediaSha256 = receipts\.length[\s\S]*?receipt\.type\}:\$\{receipt\.sha256\}/)

  const posts = read('lib/social-posts.ts')
  assert.match(posts, /media: \{ orderBy: \{ sortOrder: 'asc' as const \} \}/)
  assert.match(posts, /media: row\.media\.map\(serializeMedia\)/)
  assert.match(posts, /type: row\.type/)
  const carousel = read('components/anywhere-door/MediaCarousel.tsx')
  assert.match(carousel, /current\.type === 'VIDEO'/)
  assert.match(carousel, /src=\{current\.url\}/)
  assert.match(carousel, /src=\{current\.url\} alt=\{`\$\{title\} 图片/)
})

test('TEXT public rendering skips the empty media carousel and the migration only appends the enum value', () => {
  assert.match(read('components/anywhere-door/AnywhereDoorPostCard.tsx'), /post\.mediaType !== 'TEXT'/)
  const detail = read('components/anywhere-door/AnywhereDoorDetail.tsx')
  assert.match(detail, /post\.mediaType !== 'TEXT'/)
  assert.doesNotMatch(detail, /文字动态 · mreasonchan/)
  assert.match(read('components/anywhere-door/AnywhereDoorMorePosts.tsx'), /post\.mediaType === 'TEXT'/)

  const schema = read('prisma/schema.prisma')
  assert.match(schema, /enum SocialPostMediaType \{[\s\S]*?IMAGE[\s\S]*?VIDEO[\s\S]*?CAROUSEL[\s\S]*?REEL[\s\S]*?TEXT/)
  const migration = read('prisma/migrations/20261102090000_add_social_post_text_media_type/migration.sql')
  assert.match(migration, /ALTER TABLE `SocialPost`\s+MODIFY `mediaType` ENUM\('IMAGE', 'VIDEO', 'CAROUSEL', 'REEL', 'TEXT'\) NOT NULL;/)
  assert.doesNotMatch(migration, /DROP\s|DELETE\s|UPDATE\s|TRUNCATE\s|ALTER TABLE `(?!SocialPost`)/i)
})

test('admin sync logs expose only allowlisted error codes and safe messages', () => {
  assert.equal(safeSyncErrorCode('MEDIA_REQUEST_FAILED'), 'MEDIA_REQUEST_FAILED')
  assert.equal(safeSyncErrorMessage('MEDIA_REQUEST_FAILED'), '媒体获取失败')
  assert.equal(safeSyncErrorCode('proxy-secret-token-value'), 'SYNC_FAILED')
  assert.equal(safeSyncErrorMessage('proxy-secret-token-value'), '同步失败')
})
