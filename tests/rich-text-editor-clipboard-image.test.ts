import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RichPostContent } from '../components/posts/RichPostContent'
import { extractPlainText, normalizeRichTextImageSrc, validateRichPostContent } from '../lib/rich-text'

const editorSource = readFileSync('components/posts/RichTextEditor.tsx', 'utf8')
const browserUploadSource = readFileSync('lib/content-image-browser.ts', 'utf8')
const attachmentUploaderSource = readFileSync('components/ContentImageUploader.tsx', 'utf8')

test('uploaded inline images are valid rich-content nodes and stay out of the text mirror', () => {
  const content = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', text: '图片前' },
        { type: 'image', attrs: { src: 'https://media.ecfc.fans/media/content/user/image.webp', alt: '剪切板图片' } },
        { type: 'text', text: '图片后' },
      ],
    }],
  }
  const result = validateRichPostContent(content)
  assert.equal(result.valid, true)
  if (!result.valid) return
  assert.equal(result.plainText, '图片前图片后')
  assert.equal(extractPlainText(content), result.plainText)
  const markup = renderToStaticMarkup(createElement(RichPostContent, { richContent: content, fallbackContent: '' }))
  assert.match(markup, /class="rich-text-inline-image"/u)
  assert.match(markup, /src="https:\/\/media\.ecfc\.fans\/media\/content\/user\/image\.webp"/u)
})

test('rich-content images reject local browser payloads and unsafe URLs', () => {
  assert.equal(normalizeRichTextImageSrc('data:image/png;base64,AAAA'), null)
  assert.equal(normalizeRichTextImageSrc('blob:https://ecfc.fans/image'), null)
  assert.equal(normalizeRichTextImageSrc('javascript:alert(1)'), null)
  assert.equal(normalizeRichTextImageSrc('https://media.ecfc.fans/media/content/image.webp'), 'https://media.ecfc.fans/media/content/image.webp')
})

test('clipboard image paths intercept only real image files and share the upload helper', () => {
  assert.match(editorSource, /const items = event\.clipboardData\?\.items/u)
  assert.match(editorSource, /item\.kind !== 'file' \|\| !itemType\.startsWith\('image\/'\)/u)
  assert.match(editorSource, /item\.getAsFile\(\)/u)
  assert.match(editorSource, /event\.preventDefault\(\)/u)
  assert.match(editorSource, /return false/u)
  assert.match(editorSource, /navigator\.clipboard/u)
  assert.match(editorSource, /clipboard\.read\(\)/u)
  assert.match(editorSource, /item\.types\.find/u)
  assert.match(editorSource, /item\.getType\(type\)/u)
  assert.match(editorSource, /new File\(/u)
  assert.match(editorSource, /job\.bookmark = job\.bookmark\.map\(transaction\.mapping\)/u)
  assert.match(editorSource, /for \(let index = 0; index < job\.files\.length; index \+= 1\)/u)
  assert.match(editorSource, /上传图片/u)
  assert.match(editorSource, /从剪切板粘贴/u)
  assert.match(browserUploadSource, /export async function uploadContentImage/u)
  assert.match(attachmentUploaderSource, /uploadContentImage\(item\.file/u)
})
