import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  getRecentActivityDateRange,
  parseRecentActivityPage,
  parseRecentActivityRange,
  parseRecentActivityTab,
  RECENT_ACTIVITY_PAGE_SIZE,
} from '../lib/recent-activity'

const read = (path: string) => readFileSync(path, 'utf8')

test('最近足迹筛选使用上海自然日，默认最近一周并限制分页大小', () => {
  const now = new Date('2026-09-12T04:00:00.000Z')
  const today = getRecentActivityDateRange('today', now)
  const week = getRecentActivityDateRange('week', now)
  const month = getRecentActivityDateRange('month', now)
  const all = getRecentActivityDateRange('all', now)

  assert.equal(today.start?.toISOString(), '2026-09-11T16:00:00.000Z')
  assert.equal(today.end?.toISOString(), '2026-09-12T16:00:00.000Z')
  assert.equal(week.start?.toISOString(), '2026-09-05T16:00:00.000Z')
  assert.equal(month.start?.toISOString(), '2026-08-13T16:00:00.000Z')
  assert.equal(all.start, null)
  assert.equal(all.end, null)
  assert.equal(parseRecentActivityTab('invalid'), 'likes')
  assert.equal(parseRecentActivityRange('invalid'), 'week')
  assert.equal(parseRecentActivityPage('999999'), 10_000)
  assert.equal(RECENT_ACTIVITY_PAGE_SIZE, 20)
})

test('草稿箱复用账号级 PostDraft 与现有编辑器/API，不读取前端传入 userId', () => {
  const schema = read('prisma/schema.prisma')
  const api = read('app/api/posts/draft/route.ts')
  const form = read('components/PostCreateForm.tsx')
  const forum = read('components/ForumDiscoveryHome.tsx')
  const drafts = read('app/drafts/page.tsx')
  const draftBox = read('components/DraftBox.tsx')

  assert.match(schema, /model PostDraft\s*\{[\s\S]*userId\s+String\s+@unique[\s\S]*richContent\s+Json\?[\s\S]*imageUrls\s+Json[\s\S]*version\s+Int/u)
  assert.match(api, /getCurrentUser/u)
  assert.match(api, /where: \{ userId: auth\.user\.id \}/u)
  assert.match(api, /draftCount/u)
  assert.match(api, /DRAFT_CONFLICT/u)
  assert.doesNotMatch(api, /body\.userId/u)
  assert.match(form, /POST_DRAFT_AUTOSAVE_DEBOUNCE_MS/u)
  assert.match(form, /successful Post create comes first/u)
  assert.match(form, /clearResponse = await fetch\('\/api\/posts\/draft'/u)
  assert.match(forum, /href="\/drafts"/u)
  assert.match(forum, /draftCount/u)
  assert.match(drafts, /prisma\.postDraft\.findUnique[\s\S]*where: \{ userId: user\.id \}/u)
  assert.match(drafts, /PostCreateForm|\/posts\/new/u)
  assert.match(draftBox, /确认删除这份草稿？/u)
  assert.match(draftBox, /method: 'DELETE'/u)
  assert.match(draftBox, /继续编辑/u)
})

test('最近点赞/评论使用真实关系表，评论按帖子聚合且只给本人查询', () => {
  const service = read('lib/recent-activity.ts')
  const page = read('app/me/history/page.tsx')
  const surface = read('components/ProfilePageSurface.tsx')
  const schema = read('prisma/schema.prisma')

  assert.match(service, /prisma\.like\.findMany/u)
  assert.match(service, /prisma\.like\.count/u)
  assert.match(service, /prisma\.reply\.groupBy/u)
  assert.match(service, /by: \['postId'\]/u)
  assert.match(service, /_max: \{ createdAt: true \}/u)
  assert.match(service, /\.\.\.publicPostWhere/u)
  assert.match(service, /User: \{ status: 'ACTIVE'/u)
  assert.match(service, /Board: \{ isActive: true \}/u)
  assert.match(service, /isDeleted: false/u)
  assert.match(page, /getCurrentUser/u)
  assert.match(page, /redirect\('\/login\?redirect=%2Fme%2Fhistory'\)/u)
  assert.match(page, /最近点赞/u)
  assert.match(page, /最近评论/u)
  assert.match(page, /浏览历史/u)
  assert.match(page, /仅你可见/u)
  assert.match(surface, /href="\/me\/history"/u)
  assert.doesNotMatch(schema, /model PostViewHistory\s*\{/u)
})
