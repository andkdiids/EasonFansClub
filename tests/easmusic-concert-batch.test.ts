import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildConcertSequenceUpdates,
  cloneSetlistItems,
  DEFAULT_CONCERT_COUNTRY,
  parseConcertDates,
} from '../lib/music-concert-admin'

const read = (path: string) => readFileSync(path, 'utf8')

test('多日期场次会去重、排序并解析为独立日期', () => {
  const result = parseConcertDates(['2023-03-26', '2023-03-25', '2023-03-26'])
  assert.equal('dates' in result, true)
  if (!('dates' in result)) return
  assert.deepEqual(result.dateKeys, ['2023-03-25', '2023-03-26'])
  assert.deepEqual(result.dates.map((date) => date.toISOString().slice(0, 10)), ['2023-03-25', '2023-03-26'])
})

test('场次按日期自动编号，删除后重新生成连续顺序', () => {
  const concerts = [
    { id: 'third', concertDate: '2023-03-27' },
    { id: 'first', concertDate: '2023-03-25' },
    { id: 'second', concertDate: '2023-03-26' },
  ]
  assert.deepEqual(buildConcertSequenceUpdates(concerts), [
    { id: 'first', sessionNumber: '1', sortOrder: 1 },
    { id: 'second', sessionNumber: '2', sortOrder: 2 },
    { id: 'third', sessionNumber: '3', sortOrder: 3 },
  ])
  assert.deepEqual(buildConcertSequenceUpdates(concerts.filter((concert) => concert.id !== 'second')), [
    { id: 'first', sessionNumber: '1', sortOrder: 1 },
    { id: 'third', sessionNumber: '2', sortOrder: 2 },
  ])
})

test('同一巡演按城市分别编号，同时保留全局日期排序', () => {
  assert.deepEqual(buildConcertSequenceUpdates([
    { id: 'hong-kong-1', city: '香港', concertDate: '2022-12-09' },
    { id: 'hong-kong-2', city: '香港', concertDate: '2022-12-10' },
    { id: 'shanghai-1', city: '上海', concertDate: '2023-03-25' },
    { id: 'shanghai-2', city: '上海', concertDate: '2023-03-26' },
  ]), [
    { id: 'hong-kong-1', sessionNumber: '1', sortOrder: 1 },
    { id: 'hong-kong-2', sessionNumber: '2', sortOrder: 2 },
    { id: 'shanghai-1', sessionNumber: '1', sortOrder: 3 },
    { id: 'shanghai-2', sessionNumber: '2', sortOrder: 4 },
  ])
})

test('继承歌单为新场次创建独立副本', () => {
  const source = [{
    songId: 'song-1',
    displayName: '十年',
    section: 'MAIN' as const,
    position: 9,
    versionName: null,
    note: null,
    isEncore: false,
    isRequest: false,
    isDebut: false,
    isGuest: false,
    isMedley: false,
    isSpecial: false,
  }]
  const inherited = cloneSetlistItems(source, 'concert-2')
  assert.deepEqual(inherited, [{ ...source[0], concertId: 'concert-2', position: 1 }])
  inherited[0].displayName = 'K歌之王'
  assert.equal(source[0].displayName, '十年')
})

test('国家地区默认值为中国', () => {
  assert.equal(DEFAULT_CONCERT_COUNTRY, '中国')
  const route = read('app/api/admin/music/concerts/route.ts')
  const manager = read('app/admin/music/concerts/AdminConcertManager.tsx')
  assert.match(route, /countryOrRegion: sanitizeText\(body\?\.countryOrRegion, 100\) \|\| DEFAULT_CONCERT_COUNTRY/)
  assert.match(manager, /countryOrRegion: '中国'/)
})

test('创建、编辑与删除 API 均由系统维护场次序号', () => {
  const createRoute = read('app/api/admin/music/concerts/route.ts')
  const itemRoute = read('app/api/admin/music/concerts/[concertId]/route.ts')
  assert.match(createRoute, /body\?\.concertDates/)
  assert.match(createRoute, /for \(const concertDate of concertDates\)/)
  assert.match(createRoute, /cloneSetlistItems\(inheritedItems, concert\.id\)/)
  assert.match(createRoute, /buildConcertSequenceUpdates\(allConcerts\)/)
  assert.match(itemRoute, /normalizeTourConcerts\(tx, tourId\)/)
  assert.match(itemRoute, /normalizeTourConcerts\(tx, concert\.tourId\)/)
  assert.doesNotMatch(itemRoute, /sessionNumber: sanitizeText\(body/)
  assert.doesNotMatch(itemRoute, /sortOrder = parseLiveInteger/)
})

test('后台多选日期可添加标签和删除且不再提供手填场次编号', () => {
  const manager = read('app/admin/music/concerts/AdminConcertManager.tsx')
  assert.match(manager, /concertDates/)
  assert.match(manager, /演出日期（多选）/)
  assert.match(manager, /删除日期/)
  assert.match(manager, /使用上一场歌单/)
  assert.match(manager, /创建新歌单/)
  assert.doesNotMatch(manager, />场次编号<input/)
})

test('前台巡演详情展示地区、场次序号、场馆和歌单', () => {
  const page = read('app/music/concerts/[concertId]/page.tsx')
  assert.match(page, /共 \{tour\.MusicConcert\.length\} 场/)
  assert.match(page, /concert\.sessionNumber/)
  assert.match(page, /concert\.venue/)
  assert.match(page, /concert\.MusicConcertSetlistItem\.map/)
})
