import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('EasMusic section navigation is rendered only on the landing page', () => {
  assert.match(read('app/music/page.tsx'), /<MusicSectionNavigation \/>/)

  for (const path of [
    'app/music/albums/page.tsx',
    'app/music/concerts/page.tsx',
    'app/music/reviews/page.tsx',
    'app/music/concerts/[concertId]/page.tsx',
    'app/music/reviews/[reviewId]/page.tsx',
  ]) {
    assert.doesNotMatch(read(path), /MusicSectionNavigation/)
  }
})

test('mobile album walls use three columns without changing desktop breakpoints', () => {
  const albumsPage = read('app/music/albums/page.tsx')
  const showcase = read('components/music/MusicAlbumArchiveShowcase.tsx')
  assert.match(albumsPage, /grid min-w-0 grid-cols-3[\s\S]*sm:grid-cols-3 sm:gap-x-4[\s\S]*md:grid-cols-4 xl:grid-cols-5/)
  assert.match(showcase, /grid min-w-0 grid-cols-3[\s\S]*sm:grid-cols-3 sm:gap-x-4 md:grid-cols-5 xl:grid-cols-6/)

  const card = read('components/music/MusicAlbumCard.tsx')
  assert.match(card, /aspect-square/)
  assert.match(card, /line-clamp-2 text-\[13px\]/)
})

test('concert category cards keep their real links but do not display route text', () => {
  const cards = read('components/music/ConcertCategoryCards.tsx')
  assert.match(cards, /categories\.map/)
  assert.match(cards, /href=\{`\/music\/live\/\$\{category\.slug\}`\}/)
  assert.doesNotMatch(cards, /<span className="mt-1 truncate text-xs font-bold text-sky-200\/55">/)
})
