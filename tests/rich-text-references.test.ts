import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { RichPostContent } from '../components/posts/RichPostContent'
import { parseMentionSearchQuery } from '../lib/mention-search'
import {
  collectPostReferenceIds,
  collectUserMentionIds,
  extractPlainText,
  validateRichPostContent,
} from '../lib/rich-text'
import {
  InvalidPostReferenceError,
  InvalidUserMentionError,
  hydrateRichTextReferences,
  validateAndNormalizeRichTextReferences,
} from '../lib/rich-text-references'

const read = (path: string) => readFileSync(path, 'utf8')

const referenceDocument = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: '看这里：' },
      {
        type: 'postReference',
        attrs: { postId: 'post-1', title: '客户端伪造标题', authorName: '伪造作者', authorUid: 99999 },
      },
      { type: 'text', text: '，以及 ' },
      {
        type: 'userMention',
        attrs: { userId: 'user-1', displayName: '伪造名称', uid: 99999 },
      },
    ],
  }],
}

test('mention search keeps numeric UID mode strict and name mode fuzzy', () => {
  for (const query of ['0', '00', '000', '0000']) {
    assert.deepEqual(parseMentionSearchQuery(query), { mode: 'none', query, reason: 'partial-uid' })
  }
  assert.deepEqual(parseMentionSearchQuery('00001'), { mode: 'uid', query: '00001', uid: 1 })
  assert.deepEqual(parseMentionSearchQuery('000011'), { mode: 'none', query: '000011', reason: 'partial-uid' })
  assert.equal(parseMentionSearchQuery('And').mode, 'name')
  assert.equal(parseMentionSearchQuery('Andk').mode, 'name')
  assert.equal(parseMentionSearchQuery('海').mode, 'name')
  assert.equal(parseMentionSearchQuery('鸡腿').mode, 'name')
  assert.equal(parseMentionSearchQuery('A').mode, 'none')
})

test('post references and user mentions are real validated nodes with server-owned snapshots', async () => {
  const validated = validateRichPostContent(referenceDocument)
  assert.equal(validated.valid, true)
  if (!validated.valid) return

  assert.deepEqual(collectPostReferenceIds(validated.value), ['post-1'])
  assert.deepEqual(collectUserMentionIds(validated.value), ['user-1'])

  const normalized = await validateAndNormalizeRichTextReferences(
    validated.value,
    async () => [{
      id: 'post-1',
      title: '服务端真实标题',
      User: { uid: 1, nickname: '服务端真实作者' },
    }],
    async () => [{
      id: 'user-1',
      uid: 1,
      nickname: '服务端真实名称',
    }],
  )

  assert.equal(normalized.plainText, '看这里：服务端真实标题，以及 @服务端真实名称')
  const paragraph = normalized.richContent.content[0]
  assert.equal(paragraph.type, 'paragraph')
  if (paragraph.type !== 'paragraph') return
  assert.deepEqual(paragraph.content?.[1], {
    type: 'postReference',
    attrs: { postId: 'post-1', title: '服务端真实标题', authorName: '服务端真实作者', authorUid: 1, available: true },
  })
  assert.deepEqual(paragraph.content?.[3], {
    type: 'userMention',
    attrs: { userId: 'user-1', displayName: '服务端真实名称', uid: 1, available: true },
  })
})

test('reference validation rejects missing post and user identities', async () => {
  const validated = validateRichPostContent(referenceDocument)
  assert.equal(validated.valid, true)
  if (!validated.valid) return

  await assert.rejects(
    () => validateAndNormalizeRichTextReferences(validated.value, async () => [], async () => [{ id: 'user-1', uid: 1, nickname: '用户' }]),
    InvalidPostReferenceError,
  )

  const userOnly = validateRichPostContent({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'userMention', attrs: { userId: 'missing-user' } }] }],
  })
  assert.equal(userOnly.valid, true)
  if (!userOnly.valid) return
  await assert.rejects(
    () => validateAndNormalizeRichTextReferences(userOnly.value, async () => [], async () => []),
    InvalidUserMentionError,
  )
})

test('public hydration replaces deleted references with safe fallback nodes', async () => {
  const validated = validateRichPostContent(referenceDocument)
  assert.equal(validated.valid, true)
  if (!validated.valid) return

  const hydrated = await hydrateRichTextReferences(validated.value, async () => [], async () => [])
  const paragraph = hydrated.content[0]
  assert.equal(paragraph.type, 'paragraph')
  if (paragraph.type !== 'paragraph') return
  assert.deepEqual(paragraph.content?.[1], {
    type: 'postReference',
    attrs: { postId: 'post-1', title: '该引用帖子已不可用', authorName: '', available: false },
  })
  assert.deepEqual(paragraph.content?.[3], {
    type: 'userMention',
    attrs: { userId: 'user-1', displayName: '用户已不可用', available: false },
  })
})

test('reference and mention renderer points to existing post/profile pages and keeps unavailable fallback safe', () => {
  const markup = renderToStaticMarkup(createElement(RichPostContent, {
    richContent: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'postReference', attrs: { postId: 'post-1', title: '帖子标题', authorName: '作者', authorUid: 1, available: true } },
          { type: 'text', text: ' ' },
          { type: 'userMention', attrs: { userId: 'user-1', displayName: 'Andkdiids', uid: 1, available: true } },
          { type: 'text', text: ' ' },
          { type: 'postReference', attrs: { postId: 'deleted-post', title: '旧标题', available: false } },
          { type: 'text', text: ' ' },
          { type: 'userMention', attrs: { userId: 'deleted-user', displayName: '旧名称', available: false } },
        ],
      }],
    },
    fallbackContent: '',
  }))
  assert.match(markup, /href="\/posts\/post-1"/u)
  assert.match(markup, /href="\/user\/00001"/u)
  assert.match(markup, /该引用帖子已不可用/u)
  assert.match(markup, /@用户已不可用/u)
})

test('editor and server routes expose the requested structured toolbar/search contract', () => {
  const editor = read('components/posts/RichTextEditor.tsx')
  const mentionHelper = read('lib/mention-search.ts')
  const mentionRoute = read('app/api/users/mention-search/route.ts')
  const postRoute = read('app/api/posts/reference-search/route.ts')

  assert.match(editor, /name: 'bulletList'/u)
  assert.match(editor, /name: 'orderedList'/u)
  assert.doesNotMatch(editor, /name: 'listItem',[\s\S]{0,120}group: 'block'/u)
  assert.match(editor, /splitListItem\('listItem'\)/u)
  assert.match(editor, /liftListItem\('listItem'\)/u)
  assert.match(editor, /name: 'postReference'/u)
  assert.match(editor, /name: 'userMention'/u)
  assert.match(editor, /引用一篇站内帖子/u)
  assert.match(editor, /@用户/u)
  assert.match(editor, /role="menuitemradio"/u)
  assert.doesNotMatch(editor, /window\.prompt\(/u)
  assert.doesNotMatch(editor, /applyLink/u)

  const sizePosition = editor.indexOf('字号<span')
  const colorPosition = editor.indexOf('rich-text-color-trigger')
  const boldPosition = editor.indexOf('aria-label="加粗"')
  const italicPosition = editor.indexOf('aria-label="斜体"')
  const strikePosition = editor.indexOf('aria-label="删除线"')
  assert.ok(sizePosition >= 0 && colorPosition > sizePosition && boldPosition > colorPosition)
  assert.ok(boldPosition < italicPosition && italicPosition < strikePosition)

  assert.match(mentionHelper, /if \(query\.length !== MENTION_UID_LENGTH\)/u)
  assert.match(mentionHelper, /return \{ mode: 'uid', query, uid \}/u)
  assert.match(mentionRoute, /take: MENTION_SEARCH_RESULT_LIMIT/u)
  assert.match(mentionRoute, /Profile: \{ isNot: null \}/u)
  assert.match(postRoute, /publicPostWhere/u)
  assert.match(postRoute, /take: 15/u)

  assert.equal(extractPlainText(referenceDocument), '看这里：客户端伪造标题，以及 @伪造名称')
})
