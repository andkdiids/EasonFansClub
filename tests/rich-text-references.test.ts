import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { RichPostContent } from '../components/posts/RichPostContent'
import { parseMentionSearchQuery } from '../lib/mention-search'
import {
  collectPostReferenceIds,
  collectActivityReferenceIds,
  collectMaterialReferenceIds,
  collectUserMentionIds,
  extractPlainText,
  validateRichPostContent,
} from '../lib/rich-text'
import {
  InvalidPostReferenceError,
  InvalidUserMentionError,
  InvalidActivityReferenceError,
  InvalidMaterialReferenceError,
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

  const sizePosition = editor.indexOf('rich-text-toolbar-label">字号</span>')
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

test('activity and material references keep canonical ids and discard dynamic metadata on save', async () => {
  const document = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'activityReference', attrs: { activityId: 'activity-1', title: '伪造活动', displayStatus: 'ENDED', available: false } },
        { type: 'text', text: ' / ' },
        { type: 'materialReference', attrs: { materialId: 'material-1', title: '伪造物料', state: 'ARCHIVED', stockRemaining: 0 } },
      ],
    }],
  }
  const validated = validateRichPostContent(document)
  assert.equal(validated.valid, true)
  if (!validated.valid) return

  assert.deepEqual(collectActivityReferenceIds(validated.value), ['activity-1'])
  assert.deepEqual(collectMaterialReferenceIds(validated.value), ['material-1'])

  const normalized = await validateAndNormalizeRichTextReferences(
    validated.value,
    async () => [],
    async () => [],
    async () => [{
      id: 'activity-1',
      title: '真实活动',
      coverUrl: null,
      bannerUrl: null,
      startsAt: '2026-09-01T10:00:00.000Z',
      endsAt: '2026-09-01T12:00:00.000Z',
      locationName: 'E院现场',
      displayStatus: 'ONGOING',
      statusLabel: '进行中',
    }],
    async () => [{
      id: 'material-1',
      title: '真实物料',
      coverImageUrl: null,
      cost: 5,
      stockRemaining: 8,
      state: 'ACTIVE',
      stateLabel: '兑换中',
      linkedActivity: null,
    }],
  )

  const paragraph = normalized.richContent.content[0]
  assert.equal(paragraph.type, 'paragraph')
  if (paragraph.type !== 'paragraph') return
  assert.deepEqual(paragraph.content?.[0], { type: 'activityReference', attrs: { activityId: 'activity-1', titleSnapshot: '真实活动' } })
  assert.deepEqual(paragraph.content?.[2], { type: 'materialReference', attrs: { materialId: 'material-1', titleSnapshot: '真实物料' } })
  assert.equal(normalized.plainText, '真实活动 / 真实物料')
})

test('activity and material hydration refreshes current display data and falls back safely', async () => {
  const validated = validateRichPostContent({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'activityReference', attrs: { activityId: 'activity-1', titleSnapshot: '旧活动标题' } },
        { type: 'text', text: ' ' },
        { type: 'materialReference', attrs: { materialId: 'missing-material', titleSnapshot: '旧物料标题' } },
      ],
    }],
  })
  assert.equal(validated.valid, true)
  if (!validated.valid) return

  const hydrated = await hydrateRichTextReferences(
    validated.value,
    async () => [],
    async () => [],
    async () => [{
      id: 'activity-1',
      title: '活动最新标题',
      coverUrl: null,
      bannerUrl: null,
      startsAt: null,
      endsAt: null,
      locationName: null,
      displayStatus: 'CANCELLED',
      statusLabel: '已取消',
    }],
    async () => [],
  )
  const paragraph = hydrated.content[0]
  assert.equal(paragraph.type, 'paragraph')
  if (paragraph.type !== 'paragraph') return
  assert.deepEqual(paragraph.content?.[0], {
    type: 'activityReference',
    attrs: { activityId: 'activity-1', title: '活动最新标题', displayStatus: 'CANCELLED', statusLabel: '已取消', available: true },
  })
  assert.deepEqual(paragraph.content?.[2], {
    type: 'materialReference',
    attrs: { materialId: 'missing-material', title: '该引用物料已不可用', available: false },
  })
})

test('activity and material identities are required to exist in the public server lookup', async () => {
  const activityDocument = validateRichPostContent({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'activityReference', attrs: { activityId: 'missing-activity' } }] }],
  })
  assert.equal(activityDocument.valid, true)
  if (!activityDocument.valid) return
  await assert.rejects(
    () => validateAndNormalizeRichTextReferences(activityDocument.value, async () => [], async () => [], async () => [], async () => []),
    InvalidActivityReferenceError,
  )

  const materialDocument = validateRichPostContent({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'materialReference', attrs: { materialId: 'missing-material' } }] }],
  })
  assert.equal(materialDocument.valid, true)
  if (!materialDocument.valid) return
  await assert.rejects(
    () => validateAndNormalizeRichTextReferences(materialDocument.value, async () => [], async () => [], async () => [], async () => []),
    InvalidMaterialReferenceError,
  )
})

test('activity and material reference cards link to existing detail routes and render unavailable fallbacks', () => {
  const markup = renderToStaticMarkup(createElement(RichPostContent, {
    richContent: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'activityReference', attrs: { activityId: 'activity-1', title: '活动标题', statusLabel: '进行中', available: true } },
          { type: 'text', text: ' ' },
          { type: 'materialReference', attrs: { materialId: 'material-1', title: '物料标题', cost: 5, stockRemaining: 3, stateLabel: '兑换中', available: true } },
          { type: 'text', text: ' ' },
          { type: 'activityReference', attrs: { activityId: 'deleted-activity', title: '旧活动', available: false } },
          { type: 'text', text: ' ' },
          { type: 'materialReference', attrs: { materialId: 'deleted-material', title: '旧物料', available: false } },
        ],
      }],
    },
    fallbackContent: '',
  }))
  assert.match(markup, /href="\/activities\/activity-1"/u)
  assert.match(markup, /href="\/material-redemptions\/material-1"/u)
  assert.match(markup, /进行中/u)
  assert.match(markup, /该引用活动已不可用/u)
  assert.match(markup, /该引用物料已不可用/u)
})

test('reference menu exposes post, activity and material pickers without removing historical link support', () => {
  const editor = read('components/posts/RichTextEditor.tsx')
  const activityRoute = read('app/api/activities/reference-search/route.ts')
  const materialRoute = read('app/api/material-redemptions/reference-search/route.ts')
  assert.match(editor, /name: 'postReference'/u)
  assert.match(editor, /name: 'activityReference'/u)
  assert.match(editor, /name: 'materialReference'/u)
  assert.match(editor, /toggleReferenceMenu/u)
  assert.match(editor, /openReferencePicker\('post'\)/u)
  assert.match(editor, /openReferencePicker\('activity'\)/u)
  assert.match(editor, /openReferencePicker\('material'\)/u)
  assert.match(editor, /type: 'activityReference'/u)
  assert.match(editor, /type: 'materialReference'/u)
  assert.match(activityRoute, /searchPublicActivityReferences/u)
  assert.match(materialRoute, /searchPublicMaterialReferences/u)
  assert.match(materialRoute, /requireUser/u)
  assert.match(activityRoute, /requireUser/u)
})
