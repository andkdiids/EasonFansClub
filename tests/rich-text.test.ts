import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RichPostContent } from '../components/posts/RichPostContent'
import {
  extractPlainText,
  legacyHtmlToRichContent,
  normalizeRichTextHref,
  plainTextToRichContent,
  validateRichPostContent,
  type RichTextParagraphNode,
} from '../lib/rich-text'

const formattedPost = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: '测试标题', marks: [{ type: 'bold' }] }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '普通文字' },
        { type: 'text', text: '粗体', marks: [{ type: 'bold' }] },
        { type: 'text', text: '斜体', marks: [{ type: 'italic' }] },
        { type: 'text', text: '删除', marks: [{ type: 'strike' }] },
        { type: 'text', text: '链接', marks: [{ type: 'link', attrs: { href: 'https://ecfc.fans/' } }] },
      ],
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一项' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二项' }] }] },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 1 },
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一项' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二项' }] }] },
      ],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用' }] }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '换行第一行' },
        { type: 'hardBreak' },
        { type: 'text', text: '换行第二行', marks: [{ type: 'textColor', attrs: { token: 'red' } }] },
      ],
    },
  ],
} as const

test('rich text preserves the structure and extracts one stable plain-text mirror', () => {
  const result = validateRichPostContent(formattedPost)
  assert.equal(result.valid, true)
  if (!result.valid) return
  assert.equal(result.plainText, '测试标题\n普通文字粗体斜体删除链接\n第一项\n第二项\n第一项\n第二项\n引用\n换行第一行\n换行第二行')
  assert.equal(extractPlainText(formattedPost), result.plainText)
  const firstParagraph = result.value.content[1]
  assert.equal(firstParagraph.type, 'paragraph')
  assert.deepEqual((firstParagraph as RichTextParagraphNode).content?.[1], { type: 'text', text: '粗体', marks: [{ type: 'bold' }] })
})

test('legacy plain text becomes paragraphs and preserves blank lines', () => {
  const converted = plainTextToRichContent('第一段\n\n第二段\n第三行')
  assert.equal(converted.content.length, 4)
  assert.equal(extractPlainText(converted), '第一段\n\n第二段\n第三行')
  assert.deepEqual(converted.content[1], { type: 'paragraph' })
})

test('legacy HTML is converted to safe structured content without executing markup', () => {
  const converted = legacyHtmlToRichContent('<h2>标题</h2><p>这是 <strong>粗体</strong>。</p><ul><li>第一项</li><li>第二项</li></ul><script>alert(1)</script><p>安全</p>')
  assert.ok(converted)
  assert.equal(extractPlainText(converted), '标题\n这是 粗体。\n第一项\n第二项\n安全')
  assert.doesNotMatch(JSON.stringify(converted), /script|alert/iu)
})

test('detail renderer keeps visual semantics and produces clickable safe links', () => {
  const markup = renderToStaticMarkup(createElement(RichPostContent, {
    richContent: formattedPost,
    fallbackContent: 'fallback',
  }))
  assert.match(markup, /<h1>/u)
  assert.match(markup, /<strong>粗体<\/strong>/u)
  assert.match(markup, /<em>斜体<\/em>/u)
  assert.match(markup, /<ul>/u)
  assert.match(markup, /<ol>/u)
  assert.match(markup, /<blockquote>/u)
  assert.match(markup, /href="https:\/\/ecfc\.fans\/"/u)
  assert.match(markup, /rel="noopener noreferrer"/u)
  assert.doesNotMatch(markup, /<script|javascript:/iu)
})

test('legacy plain-text detail content keeps line breaks without exposing HTML source', () => {
  const markup = renderToStaticMarkup(createElement(RichPostContent, {
    richContent: null,
    fallbackContent: '第一行\n\n第二行 保留换行',
  }))
  assert.match(markup, /<p><span>第一行<\/span><\/p><p><\/p><p><span>第二行 保留换行<\/span><\/p>/u)
  assert.doesNotMatch(markup, /&lt;p&gt;|<script/iu)
})

test('unsafe links and unsupported nodes are rejected server-side', () => {
  const invalidValues = [
    { type: 'doc', content: [{ type: 'script', content: [{ type: 'text', text: 'alert(1)' }] }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'textColor', attrs: { token: 'url(javascript:alert(1))' } }] }] }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold', extra: 'not-allowed' }] }] }] },
  ]

  for (const value of invalidValues) assert.equal(validateRichPostContent(value).valid, false)
  assert.equal(normalizeRichTextHref('ecfc.fans/post'), 'https://ecfc.fans/post')
  assert.equal(normalizeRichTextHref('javascript:alert(1)'), null)
})

test('rich content has bounded JSON size and node count', () => {
  const tooManyNodes = {
    type: 'doc',
    content: [{ type: 'paragraph', content: Array.from({ length: 4001 }, () => ({ type: 'hardBreak' })) }],
  }
  assert.equal(validateRichPostContent(tooManyNodes).valid, false)
})

test('editor, renderer and post APIs use structured content instead of raw HTML', () => {
  const editorSource = readFileSync('components/posts/RichTextEditor.tsx', 'utf8')
  const rendererSource = readFileSync('components/posts/RichPostContent.tsx', 'utf8')
  const createSource = readFileSync('app/api/posts/route.ts', 'utf8')
  const editSource = readFileSync('app/api/posts/[postId]/route.ts', 'utf8')
  const detailSource = readFileSync('app/posts/[postId]/page.tsx', 'utf8')
  const cssSource = readFileSync('app/globals.css', 'utf8')
  assert.match(editorSource, /toggleBold/)
  assert.match(editorSource, /toggleItalic/)
  assert.match(editorSource, /toggleStrike/)
  assert.match(editorSource, /toggleList\('bulletList'/)
  assert.match(editorSource, /toggleList\('orderedList'/)
  assert.match(editorSource, /toggleWrap\('blockquote'\)/)
  assert.match(editorSource, /normalizeRichTextHref/)
  assert.match(editorSource, /onMouseDown/)
  assert.match(editorSource, /transformPastedHTML/)
  assert.doesNotMatch(editorSource, /execCommand/)
  assert.doesNotMatch(rendererSource, /dangerouslySetInnerHTML/)
  assert.match(createSource, /richContent: input\.richContent/)
  assert.match(editSource, /richContent: true/)
  assert.match(editSource, /existing\.richContent/)
  assert.match(detailSource, /richContent: true/)
  assert.match(detailSource, /richContent=\{publicRichContent\}/)
  assert.match(cssSource, /\.rich-text-toolbar \{[^}]*position: sticky/u)
  assert.match(cssSource, /\.rich-text-toolbar \{[^}]*scrollbar-width: none/u)
  assert.match(cssSource, /\.rich-post-content h1/u)
  assert.match(cssSource, /\.rich-post-content blockquote/u)
})
