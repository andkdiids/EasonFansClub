import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
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

test('manual content classification supports text, video, and text with video without placeholder media', () => {
  assert.equal(resolveManualSocialPostMediaType(true, false), 'TEXT')
  assert.equal(resolveManualSocialPostMediaType(false, true), 'VIDEO')
  assert.equal(resolveManualSocialPostMediaType(true, true), 'VIDEO')
  assert.equal(resolveManualSocialPostMediaType(false, false), null)
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
  assert.match(route, /uploadToCos\(/)
  assert.match(route, /deleteFromCos\(/)
  assert.doesNotMatch(route, /form\.get\(['"](?:userId|authorUsername|provider)['"]\)/)

  const posts = read('lib/social-posts.ts')
  const serializeBody = posts.slice(posts.indexOf('function serializePost('), posts.indexOf('export async function getPublicSocialPostFeed('))
  assert.match(serializeBody, /authorUsername: row\.authorUsername/)
  assert.doesNotMatch(serializeBody, /provider:|operatorName:|adminId:/)
  assert.match(posts, /operationType: \{ in: \['ANYWHERE_DOOR_MANUAL_POST_CREATED', 'ANYWHERE_DOOR_MANUAL_POST_DEDUPED'\]/)

  const form = read('app/admin/anywhere-door/ManualPostForm.tsx')
  assert.match(form, /if \(busy\) return/)
  assert.ok(form.indexOf('if (!response.ok) throw') < form.indexOf('formRef.current?.reset()'))
  assert.match(form, /内容已保存，但列表刷新失败/)
  assert.match(form, /setError\(caught instanceof Error/)
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
