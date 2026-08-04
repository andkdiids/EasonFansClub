import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveConcertPoster } from '@/lib/music-concert-poster'

const read = (path: string) => readFileSync(path, 'utf8')

test('场次海报按场次、城市、巡演、系统占位顺序解析', () => {
  assert.deepEqual(resolveConcertPoster({ posterUrl: ' concert.webp ', cityPosterUrl: 'city.webp', tourPosterUrl: 'tour.webp' }), {
    resolvedPosterUrl: 'concert.webp',
    posterSource: 'concert',
  })
  assert.deepEqual(resolveConcertPoster({ posterUrl: ' ', cityPosterUrl: 'city.webp', tourPosterUrl: 'tour.webp' }), {
    resolvedPosterUrl: 'city.webp',
    posterSource: 'city',
  })
  assert.deepEqual(resolveConcertPoster({ cityPosterUrl: '', tourPosterUrl: 'tour.webp' }), {
    resolvedPosterUrl: 'tour.webp',
    posterSource: 'tour',
  })
  assert.deepEqual(resolveConcertPoster({ posterUrl: null, cityPosterUrl: null, tourPosterUrl: null }), {
    resolvedPosterUrl: null,
    posterSource: 'system',
  })
})

test('前台海报入口使用统一 resolvedPosterUrl，历史空海报无需回填数据库', () => {
  const cover = read('components/music/ConcertCover.tsx')
  const detail = read('app/music/live/tours/[tourId]/[city]/[date]/page.tsx')
  const city = read('app/music/live/tours/[tourId]/[city]/page.tsx')
  const timeline = read('components/music/MusicConcertTimeline.tsx')
  const schema = read('prisma/schema.prisma')

  assert.match(cover, /resolvedPosterUrl\?: string \| null/)
  assert.match(detail, /ConcertCover resolvedPosterUrl=\{resolvedPosterUrl\}/)
  assert.match(city, /ConcertCover resolvedPosterUrl=\{resolvedCityPosterUrl\}/)
  assert.match(timeline, /ConcertCover[\s\S]*resolvedPosterUrl=\{tour\.resolvedPosterUrl\}/)
  assert.match(schema, /model MusicConcert \{[\s\S]*posterUrl\s+String\?/)
  assert.match(schema, /model MusicTour \{[\s\S]*posterUrl\s+String\?/)
})

test('后台场次显示海报来源并可清除独立海报恢复继承', () => {
  const editor = read('app/admin/music/concerts/[concertId]/AdminConcertEditor.tsx')
  const route = read('app/api/admin/music/concerts/[concertId]/route.ts')

  assert.match(editor, /当前海报来源/)
  assert.match(editor, /移除当前场次海报（保存后恢复继承）/)
  assert.match(editor, /posterSource: 'concert'/)
  assert.match(route, /resolvedPosterUrl: posterResolution\.resolvedPosterUrl/)
  assert.match(route, /posterSource: posterResolution\.posterSource/)
})
