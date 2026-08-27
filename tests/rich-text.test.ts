import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  extractPlainText,
  plainTextToRichContent,
  validateRichPostContent,
} from '../lib/rich-text'

const formattedPost = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '普通文字' },
        { type: 'text', text: 'BCD', marks: [{ type: 'bold' }] },
        { type: 'text', text: '仍然普通' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '歌词第一行' },
        { type: 'hardBreak' },
        { type: 'text', text: '歌词第二行', marks: [{ type: 'textColor', attrs: { token: 'red' } }] },
        { type: 'hardBreak' },
        {
          type: 'text',
          text: '很多年前',
          marks: [
            { type: 'bold' },
            { type: 'textColor', attrs: { token: 'red' } },
            { type: 'fontSize', attrs: { token: 'large' } },
          ],
        },
      ],
    },
  ],
} as const

test('rich text extracts plain content without losing paragraphs, hard breaks, emoji or special characters', () => {
  const result = validateRichPostContent(formattedPost)
  assert.equal(result.valid, true)
  if (!result.valid) return
  assert.equal(result.plainText, '普通文字BCD仍然普通\n歌词第一行\n歌词第二行\n很多年前')
  assert.equal(extractPlainText(formattedPost), result.plainText)

  const special = plainTextToRichContent('❤️ & <文字>\n第二行')
  assert.equal(extractPlainText(special), '❤️ & <文字>\n第二行')
})

test('local marks remain local and can be combined', () => {
  const result = validateRichPostContent(formattedPost)
  assert.equal(result.valid, true)
  if (!result.valid) return
  const firstParagraph = result.value.content[0]
  assert.deepEqual(firstParagraph.content?.[0], { type: 'text', text: '普通文字' })
  assert.deepEqual(firstParagraph.content?.[1], { type: 'text', text: 'BCD', marks: [{ type: 'bold' }] })
  assert.deepEqual(firstParagraph.content?.[2], { type: 'text', text: '仍然普通' })

  const combined = result.value.content[1].content?.[4]
  assert.deepEqual(combined, {
    type: 'text',
    text: '很多年前',
    marks: [
      { type: 'bold' },
      { type: 'textColor', attrs: { token: 'red' } },
      { type: 'fontSize', attrs: { token: 'large' } },
    ],
  })
})

test('legacy plain text becomes paragraphs and preserves blank lines', () => {
  const converted = plainTextToRichContent('第一段\n\n第二段\n第三行')
  assert.equal(converted.content.length, 4)
  assert.equal(extractPlainText(converted), '第一段\n\n第二段\n第三行')
  assert.deepEqual(converted.content[1], { type: 'paragraph' })

  const lineBreakOnly = plainTextToRichContent('\n\n')
  assert.equal(extractPlainText(lineBreakOnly).trim(), '')
})

test('unsupported nodes, marks, colors and sizes are rejected server-side', () => {
  const invalidValues = [
    { type: 'doc', content: [{ type: 'script', content: [{ type: 'text', text: 'alert(1)' }] }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link' }] }] }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'textColor', attrs: { token: 'url(javascript:alert(1))' } }] }] }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'fontSize', attrs: { token: '999px' } }] }] }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold', extra: 'not-allowed' }] }] }] },
  ]

  for (const value of invalidValues) {
    const result = validateRichPostContent(value)
    assert.equal(result.valid, false)
  }
  assert.equal(validateRichPostContent(undefined).valid, false)
})

test('rich content has bounded JSON size and node count', () => {
  const tooManyNodes = {
    type: 'doc',
    content: [{ type: 'paragraph', content: Array.from({ length: 4001 }, () => ({ type: 'hardBreak' })) }],
  }
  assert.equal(validateRichPostContent(tooManyNodes).valid, false)
})

test('editor exposes only the requested structural controls and keeps rendering out of raw HTML', () => {
  const editorSource = readFileSync('components/posts/RichTextEditor.tsx', 'utf8')
  const rendererSource = readFileSync('components/posts/RichPostContent.tsx', 'utf8')
  assert.match(editorSource, /HardBreak/)
  assert.match(editorSource, /toggleBold/)
  assert.match(editorSource, /setMark\('fontSize'/)
  assert.match(editorSource, /setMark\('textColor'/)
  assert.match(editorSource, /unsetMark\('bold'/)
  assert.match(editorSource, /undo\(\)/)
  assert.match(editorSource, /redo\(\)/)
  assert.match(editorSource, /transformPastedHTML/)
  assert.doesNotMatch(editorSource, /execCommand/)
  assert.doesNotMatch(rendererSource, /dangerouslySetInnerHTML/)
})

test('post APIs keep rich-content validation while disabling database rich-content reads and writes', () => {
  const createSource = readFileSync('app/api/posts/route.ts', 'utf8')
  const editSource = readFileSync('app/api/posts/[postId]/route.ts', 'utf8')
  const detailSource = readFileSync('app/posts/[postId]/page.tsx', 'utf8')
  const createTransaction = createSource.slice(createSource.indexOf('const post = await tx.post.create'))
  const editUpdateStart = editSource.indexOf('const updatedPost = await tx.post.update')
  const editUpdateEnd = editSource.indexOf('// 删除被移除的图片', editUpdateStart)
  const editTransaction = editSource.slice(editUpdateStart, editUpdateEnd)
  const compatibility = readFileSync('lib/post-rich-content-compat.ts', 'utf8')
  assert.match(compatibility, /POST_RICH_CONTENT_DB_ENABLED = false/)
  assert.match(createSource, /resolvePostContentInput\(/)
  assert.match(createSource, /logPostRichContentCompatibilityMode\('create'\)/)
  assert.doesNotMatch(createTransaction, /richContent/)
  assert.match(createSource, /content: input\.content/)
  assert.match(editSource, /resolvePostContentInput\(/)
  assert.match(editSource, /logPostRichContentCompatibilityMode\('edit', postId\)/)
  assert.doesNotMatch(editSource, /richContent: true/)
  assert.doesNotMatch(editSource, /existing\.richContent/)
  assert.doesNotMatch(editTransaction, /richContent/)
  assert.match(editSource, /content: rawContent/)
  assert.match(detailSource, /<RichPostContent/)
  assert.match(detailSource, /richContent=\{null\}/)
})
