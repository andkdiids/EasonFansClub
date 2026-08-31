import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { extractPlainText, plainTextToRichContent, validateRichPostContent } from '../lib/rich-text'
import {
  POST_RICH_CONTENT_DB_ENABLED,
  resolvePostContentInput,
} from '../lib/post-rich-content-compat'

const read = (path: string) => readFileSync(path, 'utf8')

test('richContent is the canonical database representation and content remains a plain mirror', () => {
  assert.equal(POST_RICH_CONTENT_DB_ENABLED, true)
  const richContent = plainTextToRichContent('第一段\n第二段')
  const result = resolvePostContentInput({
    content: '旧版正文',
    richContent,
    hasRichContent: true,
  })

  assert.equal(result.content, '第一段\n第二段')
  assert.deepEqual(result.richContent, richContent)
  assert.equal(result.usedCompatibilityMode, false)
  assert.equal(result.validation?.valid, true)
  assert.equal(resolvePostContentInput({ content: '旧版正文', richContent: null, hasRichContent: true }).richContent, null)
})

test('legacy clients still use plain text without inventing a rich payload', () => {
  const result = resolvePostContentInput({
    content: '旧版正文\n第二行',
    richContent: undefined,
    hasRichContent: false,
  })
  assert.equal(result.content, '旧版正文\n第二行')
  assert.equal(result.richContent, null)
  assert.equal(result.validation, null)
})

test('draft, publish and re-edit round-trip keeps the same JSON structure and text mirror', () => {
  const draft = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '正文', marks: [{ type: 'bold' }] }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列表' }] }] }] },
    ],
  }
  const savedDraft = resolvePostContentInput({ content: '', richContent: draft, hasRichContent: true })
  const published = resolvePostContentInput({
    content: savedDraft.content,
    richContent: JSON.parse(JSON.stringify(savedDraft.richContent)),
    hasRichContent: true,
  })
  const edited = resolvePostContentInput({
    content: published.content,
    richContent: JSON.parse(JSON.stringify(published.richContent)),
    hasRichContent: true,
  })
  assert.equal(validateRichPostContent(savedDraft.richContent).valid, true)
  assert.deepEqual(edited.richContent, savedDraft.richContent)
  assert.equal(edited.content, '标题\n正文\n列表')
  assert.equal(extractPlainText(edited.richContent), edited.content)
})

test('create, detail and edit routes all carry the same structured content field', () => {
  const create = read('app/api/posts/route.ts')
  const detailApi = read('app/api/posts/[postId]/route.ts')
  const editApi = read('app/api/posts/[postId]/edit/route.ts')
  const detailPage = read('app/posts/[postId]/page.tsx')
  const editPage = read('app/posts/[postId]/edit/page.tsx')
  const createForm = read('components/PostCreateForm.tsx')

  assert.match(create, /richContent: input\.richContent/)
  assert.match(detailApi, /richContent: true/)
  assert.match(detailApi, /validateRichPostContent\(postData\.richContent\)/)
  assert.match(editApi, /richContent: true/)
  assert.match(editApi, /validateRichPostContent\(post\.richContent\)/)
  assert.match(detailPage, /richContent: true/)
  assert.match(detailPage, /post\.richContent/)
  assert.match(editPage, /richContent: true/)
  assert.match(editPage, /initialRichContent=\{initialRichContent\}/)
  assert.match(createForm, /localStorage\.setItem/)
  assert.match(createForm, /initialRichContent=\{richContent\}/)
})
