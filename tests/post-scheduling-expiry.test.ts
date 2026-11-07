import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { calculatePostExpiresAt, isPostExpired, parsePostExpiryType, resolvePostExpiry } from '../lib/post-lifecycle'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

const scheduledAt = new Date('2026-11-07T07:57:00.000Z') // 15:57 Asia/Shanghai

/** Four independent combinations of (scheduled, time-limited). */
const combinations = [
  { name: '定时普通帖子', publishMode: 'SCHEDULED', expiryType: null },
  { name: '定时限时今日帖子', publishMode: 'SCHEDULED', expiryType: 'TODAY' },
  { name: '立即普通帖子', publishMode: 'IMMEDIATE', expiryType: null },
  { name: '立即限时今日帖子', publishMode: 'IMMEDIATE', expiryType: 'TODAY' },
] as const

test('四种组合：限时属性永远由用户选择决定，互不耦合', () => {
  for (const combo of combinations) {
    const resolved = resolvePostExpiry(combo.expiryType, scheduledAt)
    assert.equal(resolved.expiryType, combo.expiryType, `${combo.name}: expiryType 被改写`)
    if (combo.expiryType === null) {
      assert.equal(resolved.expiresAt, null, `${combo.name}: 普通帖不得获得过期时间`)
    } else {
      assert.ok(resolved.expiresAt, `${combo.name}: 限时帖必须获得过期时间`)
      assert.equal(resolved.expiresAt.getTime(), calculatePostExpiresAt(combo.expiryType, scheduledAt)!.getTime())
    }
  }
})

test('定时普通帖子到期发布后仍是普通帖子（expiresAt 为 null，永久可见）', () => {
  const expiry = resolvePostExpiry(null, scheduledAt)
  assert.deepEqual(expiry, { expiryType: null, expiresAt: null })
  assert.equal(isPostExpired(expiry.expiresAt, scheduledAt), false)
  assert.equal(isPostExpired(expiry.expiresAt, new Date('2030-01-01T00:00:00Z')), false)
})

test('定时限时今日帖子到期发布后保留限时属性且过期时间为发布当日上海自然日结束', () => {
  const expiry = resolvePostExpiry('TODAY', scheduledAt)
  assert.equal(expiry.expiryType, 'TODAY')
  assert.ok(expiry.expiresAt)
  // getShanghaiDayRange().end is the EXCLUSIVE next Shanghai midnight:
  // 2026-11-08 00:00:00 +08 == 2026-11-07T16:00:00.000Z
  assert.equal(expiry.expiresAt.toISOString(), '2026-11-07T16:00:00.000Z')
  assert.equal(isPostExpired(expiry.expiresAt, new Date('2026-11-07T15:59:59.999Z')), false)
  assert.equal(isPostExpired(expiry.expiresAt, new Date('2026-11-07T16:00:00.000Z')), true)
})

test('立即限时帖子按创建时刻计算；定时任务重算不得改变用户选择的限时类型', () => {
  const createdAt = new Date('2026-11-06T01:00:00.000Z')
  const created = resolvePostExpiry('HOURS_24', createdAt)
  const republished = resolvePostExpiry(created.expiryType, scheduledAt)
  assert.equal(created.expiryType, 'HOURS_24')
  assert.equal(republished.expiryType, 'HOURS_24')
  assert.equal(created.expiresAt!.getTime(), createdAt.getTime() + 24 * 60 * 60 * 1000)
  assert.equal(republished.expiresAt!.getTime(), scheduledAt.getTime() + 24 * 60 * 60 * 1000)
})

test('定时任务重复执行：解析函数是纯函数，且发布事务带 SCHEDULED 状态守卫', () => {
  const first = resolvePostExpiry('TODAY', scheduledAt)
  const second = resolvePostExpiry('TODAY', scheduledAt)
  assert.deepEqual(first, second)
  assert.equal(resolvePostExpiry(null, scheduledAt).expiresAt, null)

  const publisher = read('lib/post-publication.ts')
  // A second run must not find the post: the conditional update requires the
  // pre-publication state, and the status is flipped to PUBLISHED.
  assert.match(publisher, /publicationStatus:\s*'SCHEDULED',\s*scheduledPublishAt:\s*\{\s*lte:\s*now\s*\}/)
  assert.match(publisher, /publicationStatus:\s*'PUBLISHED'/)
  assert.match(publisher, /if \(updated\.count !== 1\) return false/)
})

test('定时任务执行前后数据一致性：只按已持久化的 expiryType 解析，不硬编码 TODAY', () => {
  const publisher = read('lib/post-publication.ts')
  assert.match(publisher, /expiryType:\s*true/)
  assert.match(publisher, /expiresAt:\s*true/)
  assert.match(publisher, /const expiry = resolvePostExpiry\(current\.expiryType, now\)/)
  assert.match(publisher, /\.\.\.expiry/)
  assert.match(publisher, /\[post-publication\.expiry\]/)
  assert.doesNotMatch(publisher, /expiryType:\s*['"]TODAY['"]/)
})

test('API 层不注入默认限时值，定时创建时保留 expiryType 且把 expiresAt 留空', () => {
  const api = read('app/api/posts/route.ts')
  assert.match(api, /parsePostExpiryType\(body\.expiryType\)/)
  assert.match(api, /resolvePostExpiry\(expiryType, createdAt\)/)
  assert.match(api, /expiryType:\s*parsePostExpiryType\(expiryType\), expiresAt: null/)
  assert.doesNotMatch(api, /expiryType\s*\?\?/)
  assert.doesNotMatch(api, /Boolean\(body\.expiryType\)/)
  assert.doesNotMatch(api, /expiryType:\s*['"]TODAY['"]/)
  const form = read('components/PostCreateForm.tsx')
  // The form forwards the user's state verbatim; it must not force false.
  assert.match(form, /expiryType:\s*expiryType \|\| null/)
  assert.doesNotMatch(form, /expiryType:\s*false/)
})

test('审核即时发布与定时发布共用同一个到期解析入口', () => {
  const review = read('app/api/admin/posts/review/route.ts')
  assert.match(review, /\.\.\.resolvePostExpiry\(current\.expiryType, reviewedAt\)/)
  assert.match(review, /expiresAt:\s*null/)
})

test('迁移不得给 Post 增加 TODAY 默认值或回填限时字段', () => {
  const migration = read('prisma/migrations/20261105120000_add_scheduled_post_publication/migration.sql')
  assert.doesNotMatch(migration, /\bUPDATE\s+`?Post`?/i)
  assert.doesNotMatch(migration, /expiryType/i)
  const original = read('prisma/migrations/20260919130000_add_post_topics_and_expiry/migration.sql')
  assert.match(original, /`expiryType`\s+ENUM\('TODAY'/)
  assert.doesNotMatch(original, /DEFAULT\s+'TODAY'/i)
})

test('非法限时值一律归一为普通帖子，不会被误当成限时今日', () => {
  for (const value of [undefined, null, '', 'NOT_A_TYPE', 0, false, {}]) {
    const parsed = parsePostExpiryType(value)
    assert.equal(parsed, null)
    assert.equal(resolvePostExpiry(parsed, scheduledAt).expiresAt, null)
  }
  assert.equal(parsePostExpiryType('TODAY'), 'TODAY')
})
