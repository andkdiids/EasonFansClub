import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  mergeRestoredPostDraft,
  parsePostDraftPayload,
  postDraftPayloadKey,
  POST_DRAFT_FIELDS,
  type PostDraftPayload,
} from '../lib/post-draft'
import { parsePostExpiryType, resolvePostExpiry } from '../lib/post-lifecycle'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

const emptyDraft = (overrides: Partial<PostDraftPayload> = {}): PostDraftPayload => ({
  boardId: 'board-general',
  title: '',
  content: '',
  richContent: null,
  imageUrls: [],
  pendingSticker: null,
  topicNames: [],
  expiryType: null,
  ...overrides,
})

/** The exact wire payload the form builds in submitPost(). */
function buildWirePayload(state: PostDraftPayload, publishMode: 'IMMEDIATE' | 'SCHEDULED') {
  return {
    expiryType: state.expiryType || null,
    publishMode,
    ...(publishMode === 'SCHEDULED' ? { scheduledPublishAt: '2026-11-08T02:00:00.000Z' } : {}),
  }
}

/** What the create API persists for a post (scheduled path keeps expiresAt NULL). */
function persistedPostFields(wire: ReturnType<typeof buildWirePayload>) {
  const expiryType = parsePostExpiryType(wire.expiryType)
  return wire.publishMode === 'SCHEDULED'
    ? { expiryType, expiresAt: null }
    : resolvePostExpiry(expiryType, new Date('2026-11-07T07:57:00.000Z'))
}

const combinations = [
  { name: '立即发布 / 不限时', publishMode: 'IMMEDIATE', expiryType: null, expectType: null, expectExpiresAt: false },
  { name: '立即发布 / 限时今日', publishMode: 'IMMEDIATE', expiryType: 'TODAY', expectType: 'TODAY', expectExpiresAt: true },
  { name: '定时发布 / 不限时', publishMode: 'SCHEDULED', expiryType: null, expectType: null, expectExpiresAt: false },
  { name: '定时发布 / 限时今日', publishMode: 'SCHEDULED', expiryType: 'TODAY', expectType: 'TODAY', expectExpiresAt: true },
] as const

test('四种组合：表单 payload → API 解析 → DB 字段 → 到期发布全链路一致', () => {
  const publicationTime = new Date('2026-11-08T02:00:00.000Z')
  for (const combo of combinations) {
    const wire = buildWirePayload(emptyDraft({ expiryType: combo.expiryType }), combo.publishMode)
    const created = persistedPostFields(wire)
    assert.equal(created.expiryType, combo.expectType, `${combo.name}: expiryType 被改写`)
    // A scheduled post defers expiresAt to the publication job; an immediate
    // post resolves it at creation time.
    if (combo.publishMode === 'SCHEDULED') {
      assert.equal(created.expiresAt, null, `${combo.name}: 定时帖创建时不得设置 expiresAt`)
    } else {
      assert.equal(created.expiresAt !== null, combo.expectExpiresAt, `${combo.name}: 创建时 expiresAt 错误`)
    }
    // The publication job resolves from the persisted expiryType only.
    const published = resolvePostExpiry(created.expiryType, publicationTime)
    assert.equal(published.expiryType, combo.expectType, `${combo.name}: 到期发布改写了 expiryType`)
    assert.equal(published.expiresAt !== null, combo.expectExpiresAt, `${combo.name}: 到期发布后 expiresAt 错误`)
    if (combo.expectType === 'TODAY') {
      assert.equal(published.expiresAt!.toISOString(), '2026-11-08T16:00:00.000Z')
    }
  }
})

test('回归：陈旧的 TODAY 草稿不得把「定时发布 / 不限时」变成限时今日帖子', () => {
  // Reproduces the reported incident: the user never chose 限时今日, but the
  // async GET /api/posts/draft resolves with an old draft carrying TODAY.
  const baseline = emptyDraft()
  const current = emptyDraft() // user left 限时发布 at 普通帖子（永久）
  const server = emptyDraft({ title: '旧草稿', expiryType: 'TODAY' })

  const effective = mergeRestoredPostDraft(server, current, baseline)
  assert.equal(effective.expiryType, null, '限时属性被草稿静默注入')
  assert.equal(effective.title, '旧草稿', '未编辑的正文仍应正常恢复')

  const wire = buildWirePayload(effective, 'SCHEDULED')
  assert.equal(wire.expiryType, null)
  assert.deepEqual(persistedPostFields(wire), { expiryType: null, expiresAt: null })
})

test('回归：恢复期间用户刚选择的限时属性优先于云端草稿', () => {
  const baseline = emptyDraft()
  const userChose = emptyDraft({ expiryType: 'HOURS_24', title: '用户刚写的标题' })
  const server = emptyDraft({ expiryType: 'TODAY', title: '云端旧标题' })

  const effective = mergeRestoredPostDraft(server, userChose, baseline)
  assert.equal(effective.expiryType, 'HOURS_24', '用户的限时选择被覆盖')
  assert.equal(effective.title, '用户刚写的标题', '用户刚输入的内容被覆盖')
  assert.equal(buildWirePayload(effective, 'SCHEDULED').expiryType, 'HOURS_24')
})

test('回归：用户明确改为普通帖子时，草稿里的限时值同样不得复活', () => {
  const baseline = emptyDraft()
  const userChose = emptyDraft({ expiryType: null })
  const server = emptyDraft({ expiryType: 'DAYS_7' })
  const effective = mergeRestoredPostDraft(server, userChose, baseline)
  assert.equal(effective.expiryType, null)
  assert.deepEqual(persistedPostFields(buildWirePayload(effective, 'SCHEDULED')), { expiryType: null, expiresAt: null })
})

test('草稿恢复只影响可持久化字段，未编辑字段正常回填', () => {
  const baseline = emptyDraft()
  const current = emptyDraft({ topicNames: ['用户刚选的话题'] })
  const server = emptyDraft({
    boardId: 'board-2', title: '云端标题', content: '云端正文',
    imageUrls: ['/uploads/a.png'], topicNames: ['云端话题'], expiryType: 'TODAY',
  })
  const effective = mergeRestoredPostDraft(server, current, baseline)
  assert.equal(effective.boardId, 'board-2')
  assert.equal(effective.title, '云端标题')
  assert.equal(effective.content, '云端正文')
  assert.deepEqual(effective.imageUrls, ['/uploads/a.png'])
  assert.deepEqual(effective.topicNames, ['用户刚选的话题'], '用户编辑过的字段被覆盖')
  assert.equal(effective.expiryType, null)
})

test('publishMode / scheduledPublishLocal 不属于草稿 payload，恢复链路无法触碰', () => {
  const fields: readonly string[] = POST_DRAFT_FIELDS
  assert.equal(fields.includes('publishMode'), false)
  assert.equal(fields.includes('scheduledPublishLocal'), false)
  const form = read('components/PostCreateForm.tsx')
  assert.doesNotMatch(form, /setPublishMode\(payload\./)
  assert.doesNotMatch(form, /setScheduledPublishLocal\(payload\./)
  // The submit payload forwards the user's live state verbatim.
  assert.match(form, /expiryType:\s*expiryType \|\| null/)
  assert.match(form, /publishMode,/)
})

test('草稿保存仍保留 expiryType（服务端不变），但 UI 恢复不沿用', () => {
  const parsed = parsePostDraftPayload({
    boardId: 'board-general', title: 't', content: 'c',
    imageUrls: [], topicNames: [], expiryType: 'TODAY',
  })
  assert.equal(parsed?.expiryType, 'TODAY', '服务端草稿契约不应被破坏')
  assert.equal(postDraftPayloadKey(emptyDraft({ expiryType: 'TODAY' })) !== postDraftPayloadKey(emptyDraft()), true)
})

test('恢复链路契约：merge + gate + 保留服务端同步键', () => {
  const form = read('components/PostCreateForm.tsx')
  assert.match(form, /mergeRestoredPostDraft\(restored, currentPayloadRef\.current, baselineAtMount\)/)
  assert.match(form, /const effectiveDraft = applyRestoredDraft\(serverPayload\)/)
  assert.match(form, /lastSyncedPayloadKeyRef\.current = postDraftPayloadKey\(serverPayload\)/)
  // Controls must not be actionable while the async restore is in flight.
  assert.match(form, /value=\{expiryType\}[\s\S]{0,300}disabled=\{!draftReady\}/)
  assert.match(form, /name="publishMode" value="SCHEDULED"[\s\S]{0,200}disabled=\{!draftReady\}/)
  assert.match(form, /disabled=\{isSubmitting \|\| imagesUploading \|\| !draftReady\}/)
  assert.match(form, /disabled=\{!scheduleWindowAvailable \|\| !draftReady\}/)
  assert.match(form, /草稿中保存了限时发布设置/)
})

test('编辑定时帖子与定时任务不得改写限时属性', () => {
  const edit = read('app/api/posts/[postId]/route.ts')
  assert.doesNotMatch(edit, /expiryType:\s*['"]TODAY['"]/)
  assert.doesNotMatch(edit, /data:\s*\{[\s\S]{0,200}expiryType:/)
  const publisher = read('lib/post-publication.ts')
  assert.match(publisher, /const expiry = resolvePostExpiry\(current\.expiryType, now\)/)
  assert.match(publisher, /if \(updated\.count !== 1\) return false/)
  assert.doesNotMatch(publisher, /expiryType:\s*['"]TODAY['"]/)
})

test('API 与表单均不注入 TODAY 默认值', () => {
  const api = read('app/api/posts/route.ts')
  const draft = read('app/api/posts/draft/route.ts')
  const lifecycle = read('lib/post-lifecycle.ts')
  for (const source of [api, draft, lifecycle]) {
    assert.doesNotMatch(source, /expiryType\s*:\s*['"]TODAY['"]/)
    assert.doesNotMatch(source, /expiryType\s*\?\?\s*['"]TODAY['"]/)
  }
  assert.match(api, /parsePostExpiryType\(body\.expiryType\)/)
})
