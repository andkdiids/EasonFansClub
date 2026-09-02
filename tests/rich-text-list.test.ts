import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RichPostContent } from '../components/posts/RichPostContent'
import { validateRichPostContent } from '../lib/rich-text'

const editorSource = readFileSync('components/posts/RichTextEditor.tsx', 'utf8')
const cssSource = readFileSync('app/globals.css', 'utf8')

const listDocument = {
  type: 'doc',
  content: [
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '无序第一项' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '无序第二项' }] }] },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 1 },
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '有序第一项' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '有序第二项' }] }] },
      ],
    },
  ],
} as const

test('list extensions are registered once with semantic list-item content', () => {
  const extensionBlock = editorSource.slice(editorSource.indexOf('const richListItem'), editorSource.indexOf('const richBlockquote'))
  assert.equal((extensionBlock.match(/name: 'bulletList'/gu) || []).length, 1)
  assert.equal((extensionBlock.match(/name: 'orderedList'/gu) || []).length, 1)
  assert.equal((extensionBlock.match(/name: 'listItem'/gu) || []).length, 1)
  assert.match(extensionBlock, /content: 'paragraph block\*'/u)
  assert.match(editorSource, /richBulletList,\s*richOrderedList,\s*richListItem/u)
})

test('bullet and ordered toolbar options call separate real list commands', () => {
  assert.match(editorSource, /toggleBulletList: \(\) =>[\s\S]*?toggleList\('bulletList', 'listItem'\)/u)
  assert.match(editorSource, /toggleOrderedList: \(\) =>[\s\S]*?toggleList\('orderedList', 'listItem'\)/u)
  assert.match(editorSource, /if \(listType === 'bulletList'\) startCommand\(\)\.toggleBulletList\(\)\.run\(\)/u)
  assert.match(editorSource, /else startCommand\(\)\.toggleOrderedList\(\)\.run\(\)/u)
})

test('list keyboard behavior keeps Enter in the list and only lifts an empty item on Backspace', () => {
  assert.match(editorSource, /commands\.splitListItem\('listItem'\)/u)
  assert.match(editorSource, /commands\.liftEmptyBlock\(\)/u)
  assert.match(editorSource, /if \(!isEmptyListItemAtStart\(this\.editor\)\) return false/u)
  assert.doesNotMatch(editorSource, /'Mod-Backspace'|'Shift-Backspace'/u)
})

test('list JSON renders as real UL/OL DOM and restores visible markers in both surfaces', () => {
  const validation = validateRichPostContent(listDocument)
  assert.equal(validation.valid, true)
  const markup = renderToStaticMarkup(createElement(RichPostContent, { richContent: listDocument, fallbackContent: '' }))
  assert.match(markup, /<ul><li><p><span>无序第一项<\/span><\/p><\/li><li><p><span>无序第二项<\/span><\/p><\/li><\/ul>/u)
  assert.match(markup, /<ol><li><p><span>有序第一项<\/span><\/p><\/li><li><p><span>有序第二项<\/span><\/p><\/li><\/ol>/u)
  assert.match(cssSource, /\.rich-text-editor-surface ul \{[^}]*list-style-type: disc;[^}]*\}/u)
  assert.match(cssSource, /\.rich-text-editor-surface ol \{[^}]*list-style-type: decimal;[^}]*\}/u)
  assert.match(cssSource, /\.rich-text-editor-surface li \{[^}]*display: list-item;[^}]*\}/u)
  assert.match(cssSource, /\.rich-post-content ul \{[^}]*list-style-type: disc;[^}]*\}/u)
  assert.match(cssSource, /\.rich-post-content ol \{[^}]*list-style-type: decimal;[^}]*\}/u)
  assert.match(cssSource, /\.rich-post-content li \{[^}]*display: list-item;[^}]*\}/u)
  assert.doesNotMatch(cssSource, /\.rich-text-editor-surface (?:ul|ol|li)[^}]*list-style(?:-type)?:\s*none/u)
  assert.doesNotMatch(cssSource, /\.rich-post-content (?:ul|ol|li)[^}]*list-style(?:-type)?:\s*none/u)
})
