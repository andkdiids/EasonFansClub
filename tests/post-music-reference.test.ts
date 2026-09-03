import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { RichPostContent } from '../components/posts/RichPostContent'
import {
  collectMusicReferenceSongIds,
  countMusicReferenceNodes,
  enrichMusicReferenceMetadata,
  extractPlainText,
  MAX_RICH_TEXT_MUSIC_REFERENCES,
  validateRichPostContent,
} from '../lib/rich-text'
import { InvalidPostMusicReferenceError, validateAndNormalizePostMusicReferences } from '../lib/post-music-references'

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
  assert.match(markup, /class="rich-text-music-reference-play"/u)
  assert.match(markup, /▶ 播放/u)
  assert.match(markup, /<a[^>]*rich-text-music-reference-link[^>]*>[\s\S]*<\/a><button[^>]*rich-text-music-reference-play/u)
  assert.match(markup, /陀飞轮/u)
  assert.match(markup, /陈奕迅/u)
  assert.match(markup, /Time Flies/u)
  assert.doesNotMatch(markup, /musicReference|songId/u)
})

test('one music reference is enforced by the shared server normalization boundary', async () => {
  const twoReferenceDocument = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'musicReference', attrs: { songId: 'song-1', title: '第一首' } },
        { type: 'text', text: ' ' },
        { type: 'musicReference', attrs: { songId: 'song-2', title: '第二首' } },
      ],
    }],
  }
  const validated = validateRichPostContent(twoReferenceDocument)
  assert.equal(validated.valid, true)
  if (!validated.valid) return

  assert.equal(MAX_RICH_TEXT_MUSIC_REFERENCES, 1)
  assert.equal(countMusicReferenceNodes(validated.value), 2)
  await assert.rejects(
    () => validateAndNormalizePostMusicReferences(validated.value, async () => []),
    (error: unknown) => error instanceof InvalidPostMusicReferenceError
      && error.reason === 'TOO_MANY'
      && error.message === '每篇帖子最多引用 1 首歌曲',
  )
})

test('post song playback is scoped to the detail component and only accepts full playback responses', () => {
  const renderer = read('components/posts/RichPostContent.tsx')
  const detailPage = read('app/posts/[postId]/page.tsx')
  const editor = read('components/posts/RichTextEditor.tsx')
  const css = read('app/globals.css')

  assert.match(renderer, /getMusicPlaybackUrl\(songId\)/u)
  assert.match(renderer, /body\.isFullPlayback !== true/u)
  assert.match(renderer, /audio\.pause\(\)/u)
  assert.match(renderer, /audio\.removeAttribute\('src'\)/u)
  assert.match(renderer, /audio\.removeEventListener\('ended'/u)
  assert.doesNotMatch(renderer, /MusicPlayerProvider|currentTrack|queue|recent/u)
  assert.match(detailPage, /musicReferences=\{musicReferences\}/u)
  assert.match(detailPage, /enableSongPlayback/u)
  assert.match(detailPage, /scopeKey=\{post\.id\}/u)
  assert.match(editor, /handlePaste:/u)
  assert.match(editor, /openReferencePicker\('music'\)/u)
  assert.match(editor, /createPortal\(referenceMenu, document\.body\)/u)
  assert.match(css, /rich-text-reference-menu-viewport \{ position: fixed;[^}]*z-index: 70/u)
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
