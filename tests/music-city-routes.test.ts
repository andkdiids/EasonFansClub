import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { formatLiveDate } from '@/lib/music-live'
import { generateCitySlug } from '@/lib/music-slug'

const read = (path: string) => readFileSync(path, 'utf8')

test('海外中文城市生成稳定的 ASCII slug', () => {
  assert.deepEqual(
    ['新加坡', '吉隆坡', '纽约', '多伦多', '芝加哥', '安纳海姆', '旧金山', '温哥华'].map(generateCitySlug),
    ['SINGAPORE', 'KUALA-LUMPUR', 'NEW-YORK', 'TORONTO', 'CHICAGO', 'ANAHEIM', 'SAN-FRANCISCO', 'VANCOUVER'],
  )
})

test('城市详情对坏编码、空数据和非法日期提供受控状态', () => {
  const page = read('app/music/live/tours/[tourId]/[city]/page.tsx')
  const archive = read('lib/music-archive.ts')
  const cover = read('components/music/ConcertCover.tsx')
  const error = read('app/music/live/tours/[tourId]/[city]/error.tsx')
  const loading = read('app/music/live/tours/[tourId]/[city]/loading.tsx')

  assert.match(page, /cityConcerts\.map\(\(concert\) => concert\.posterUrl\)/)
  assert.match(page, /暂无歌单资料/)
  assert.match(archive, /try \{[\s\S]*decodeURIComponent\(citySlug\)[\s\S]*catch/)
  assert.match(cover, /publicImageUrl\(value\)/)
  assert.match(error, /重新加载/)
  assert.match(error, /返回巡演详情/)
  assert.match(loading, /animate-pulse/)
  assert.equal(formatLiveDate('not-a-date'), '时间待整理')
})
