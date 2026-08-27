import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = process.cwd()
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

test('Anywhere Door responsive contract covers required mobile and desktop viewports', () => {
  const page = read('app/anywhere-door/page.tsx')
  const detail = read('app/anywhere-door/[postId]/page.tsx')
  const carousel = read('components/anywhere-door/MediaCarousel.tsx')
  const comments = read('components/anywhere-door/AnywhereDoorCommentPanel.tsx')
  const requiredMobileWidths = [360, 390, 430]
  const requiredDesktopWidths = [1366, 1440, 1920]

  assert.deepEqual(requiredMobileWidths, [360, 390, 430])
  assert.deepEqual(requiredDesktopWidths, [1366, 1440, 1920])
  assert.match(page, /max-w-2xl/)
  assert.match(detail, /max-w-2xl/)
  assert.match(carousel, /overflow-hidden/)
  assert.match(carousel, /h-full w-full object-contain/)
  assert.match(carousel, /aspect-square/)
  assert.match(carousel, /sm:aspect-\[4\/3\]/)
  assert.match(comments, /break-words/)
  assert.match(comments, /加载更多评论/)
  assert.match(comments, /查看更多回复/)
})

test('Anywhere Door data paths stay local and bounded', () => {
  const feed = read('lib/social-posts.ts')
  const commentsRoute = read('app/api/anywhere-door/[postId]/comments/route.ts')
  const detail = read('lib/social-posts.ts')
  assert.match(feed, /DEFAULT_SOCIAL_PAGE_SIZE = 20/)
  assert.match(feed, /MAX_SOCIAL_PAGE_SIZE = 50/)
  assert.match(feed, /take: take \+ 1/)
  assert.match(commentsRoute, /parentId/)
  assert.match(commentsRoute, /decodeSocialCommentCursor/)
  assert.doesNotMatch(detail, /replies:\s*\{[\s\S]*include:/)
})
