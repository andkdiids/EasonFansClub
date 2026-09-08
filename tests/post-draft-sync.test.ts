import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createStoredPostDraft,
  hasMeaningfulPostDraftContent,
  normalizeServerPostDraft,
  parseStoredPostDraft,
  postDraftPayloadKey,
  POST_DRAFT_AUTOSAVE_DEBOUNCE_MS,
  POST_DRAFT_LOCAL_CACHE_DEBOUNCE_MS,
  type PostDraftPayload,
} from '../lib/post-draft'
import type { RichTextContent } from '../lib/rich-text'

function read(relativePath: string) {
  return readFileSync(relativePath, 'utf8')
}

const richContent: RichTextContent = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: '跨设备草稿', marks: [{ type: 'bold' }] },
      { type: 'musicReference', attrs: { songId: 'song-1', title: '歌曲', artist: '歌手' } },
    ],
  }],
}

const payload: PostDraftPayload = {
  boardId: 'board-1',
  title: '跨设备标题',
  content: '跨设备草稿歌曲',
  richContent,
  imageUrls: ['https://cdn.example.com/post-image.png'],
  pendingSticker: { id: 'sticker-1', name: '表情', url: 'https://cdn.example.com/sticker.png', type: 'STATIC' },
}

test('草稿 payload 保留富文本、图片、分区、引用歌曲和表情，并可跨本地缓存往返', () => {
  const stored = createStoredPostDraft(payload, 7, '2026-09-08T12:00:00.000Z')
  const restored = parseStoredPostDraft(JSON.stringify(stored), ['board-1'])
  assert.deepEqual(restored, stored)
  assert.equal(hasMeaningfulPostDraftContent(payload), true)
  assert.equal(postDraftPayloadKey(restored!), postDraftPayloadKey(payload))
})

test('服务端版本包含服务端 updatedAt，客户端时间只作为本地备份元数据', () => {
  const server = normalizeServerPostDraft({
    id: 'draft-1',
    version: 8,
    updatedAt: '2026-09-08T12:10:00.000Z',
    ...payload,
  }, ['board-1'])
  assert.equal(server?.version, 8)
  assert.equal(server?.updatedAt, '2026-09-08T12:10:00.000Z')
  assert.equal(server?.title, payload.title)
  assert.deepEqual(server?.richContent, payload.richContent)
})

test('草稿同步契约：服务端归属、乐观版本冲突、本地迁移和发布后清理均存在', () => {
  const route = read('app/api/posts/draft/route.ts')
  const form = read('components/PostCreateForm.tsx')
  const page = read('app/posts/new/page.tsx')
  const editForm = read('components/PostEditForm.tsx')
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260908130000_add_post_draft/migration.sql')

  assert.match(schema, /model PostDraft\s*\{[\s\S]*userId\s+String\s+@unique[\s\S]*richContent\s+Json\?[\s\S]*imageUrls\s+Json[\s\S]*version\s+Int\s+@default\(1\)/u)
  assert.match(migration, /CREATE TABLE `PostDraft`/u)
  assert.match(migration, /UNIQUE INDEX `PostDraft_userId_key`\(`userId`\)/u)
  assert.match(migration, /FOREIGN KEY \(`userId`\) REFERENCES `User`\(`id`\) ON DELETE CASCADE/u)

  assert.match(page, /PostCreateForm[^>]*userId=\{user\.id\}/u)
  assert.match(route, /getCurrentUser/u)
  assert.match(route, /userId: auth\.user\.id/u)
  assert.match(route, /expectedVersion/u)
  assert.match(route, /DRAFT_CONFLICT/u)
  assert.match(route, /updateMany\([\s\S]*version: expectedVersion/u)
  assert.match(route, /postDraft\.deleteMany\(\{ where: \{ userId: auth\.user\.id \} \}\)/u)
  assert.doesNotMatch(route, /body\.userId/u)
  assert.doesNotMatch(route, /prisma\.post\.create|recordQualifiedPublishedPostGrowth|createManyNotifications/u)

  assert.match(form, /fetch\('\/api\/posts\/draft'/u)
  assert.match(form, /POST_DRAFT_AUTOSAVE_DEBOUNCE_MS/u)
  assert.match(form, /POST_DRAFT_LOCAL_CACHE_DEBOUNCE_MS/u)
  assert.match(form, /POST_DRAFT_STORAGE_KEY/u)
  assert.match(form, /这份草稿已在另一台设备更新/u)
  assert.match(form, /clearResponse = await fetch\('\/api\/posts\/draft'/u)
  assert.match(form, /successful Post create comes first/u)
  assert.doesNotMatch(editForm, /\/api\/posts\/draft/u)
  assert.equal(POST_DRAFT_AUTOSAVE_DEBOUNCE_MS, 1000)
  assert.equal(POST_DRAFT_LOCAL_CACHE_DEBOUNCE_MS, 250)
})
