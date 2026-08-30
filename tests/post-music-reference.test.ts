import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { RichPostContent } from '../components/posts/RichPostContent'
import {
  collectMusicReferenceSongIds,
  enrichMusicReferenceMetadata,
  extractPlainText,
  validateRichPostContent,
} from '../lib/rich-text'

const read = (path: string) => readFileSync(path, 'utf8')

const musicDocument = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: '听这首：' },
      { type: 'musicReference', attrs: { songId: 'song-1', title: '陀飞轮', artist: '陈奕迅', album: 'Time Flies' } },
      { type: 'text', text: ' 很喜欢。' },
    ],
  }],
}

test('EasMusic reference is a validated structured inline node and plain-text summaries use its title', () => {
  const result = validateRichPostContent(musicDocument)
  assert.equal(result.valid, true)
  if (!result.valid) return
  assert.deepEqual(collectMusicReferenceSongIds(result.value), ['song-1'])
  assert.equal(result.plainText, '听这首：陀飞轮 很喜欢。')
  assert.equal(extractPlainText(result.value), result.plainText)
})

test('server song metadata enrichment keeps the song id and replaces forged display metadata', () => {
  const result = validateRichPostContent(musicDocument)
  assert.equal(result.valid, true)
  if (!result.valid) return
  const enriched = enrichMusicReferenceMetadata(result.value, new Map([
    ['song-1', { title: '官方歌曲名', artist: '官方歌手', album: '官方专辑' }],
  ]))
  const firstBlock = enriched.content[0]
  assert.equal(firstBlock.type, 'paragraph')
  if (firstBlock.type !== 'paragraph') return
  const referencedNode = firstBlock.content?.[1]
  assert.equal(referencedNode?.type, 'musicReference')
  if (referencedNode?.type !== 'musicReference') return
  assert.equal(referencedNode.attrs.songId, 'song-1')
  assert.equal(referencedNode.attrs.title, '官方歌曲名')
  assert.equal(extractPlainText(enriched), '听这首：官方歌曲名 很喜欢。')
})

test('music reference renderer links to the existing EasMusic song page', () => {
  const markup = renderToStaticMarkup(createElement(RichPostContent, { richContent: musicDocument, fallbackContent: '' }))
  assert.match(markup, /href="\/music\/song\/song-1"/u)
  assert.match(markup, /陀飞轮/u)
  assert.match(markup, /陈奕迅/u)
  assert.match(markup, /Time Flies/u)
  assert.doesNotMatch(markup, /musicReference|songId/u)
})

test('post editor and APIs use the existing search endpoint and validate references on create/edit', () => {
  const editor = read('components/posts/RichTextEditor.tsx')
  const picker = read('components/posts/MusicReferencePicker.tsx')
  const createRoute = read('app/api/posts/route.ts')
  const editRoute = read('app/api/posts/[postId]/route.ts')
  assert.match(picker, /\/api\/music\/search\?q=/u)
  assert.match(picker, /300/u)
  assert.match(editor, /name: 'musicReference'/u)
  assert.match(editor, /引用 EasMusic 歌曲/u)
  assert.match(editor, /insertContent\(\{[\s\S]*type: 'musicReference'/u)
  assert.match(createRoute, /validateAndNormalizePostMusicReferences/u)
  assert.match(createRoute, /MusicAlbum: \{ status: 'PUBLISHED' \}/u)
  assert.match(editRoute, /validateAndNormalizePostMusicReferences/u)
  assert.match(editRoute, /MusicAlbum: \{ status: 'PUBLISHED' \}/u)
})

test('invalid structured song identities are rejected before persistence', () => {
  const invalidId = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'musicReference', attrs: { songId: '   ' } }] }],
  }
  assert.equal(validateRichPostContent(invalidId).valid, false)
  assert.match(read('lib/post-music-references.ts'), /InvalidPostMusicReferenceError/u)
})
