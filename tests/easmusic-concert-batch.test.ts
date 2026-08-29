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

test('始终按演出日期自动排序，忽略手动 sortOrder', () => {
  assert.deepEqual(buildConcertSequenceUpdates([
    { id: 'date-first', city: '澳门', concertDate: '2024-01-01', sortOrder: 2 },
    { id: 'date-later', city: '澳门', concertDate: '2024-02-01', sortOrder: 1 },
    { id: 'new', city: '澳门', concertDate: '2023-12-01', sortOrder: 0 },
  ]), [
    { id: 'new', sessionNumber: '1', sortOrder: 1 },
    { id: 'date-first', sessionNumber: '2', sortOrder: 2 },
    { id: 'date-later', sessionNumber: '3', sortOrder: 3 },
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

test('继承歌单保留曲序、段落、版本、备注和所有现场标记，并独立编号 Encore', () => {
  const source = [
    { songId: 'song-2', displayName: 'Encore', section: 'ENCORE' as const, position: 20, versionName: 'Live', note: '尾声', isEncore: true, isRequest: false, isDebut: false, isGuest: true, isMedley: false, isSpecial: true },
    { songId: 'song-1', displayName: '主歌', section: 'MAIN' as const, position: 10, versionName: 'Acoustic', note: '开场', isEncore: false, isRequest: true, isDebut: true, isGuest: false, isMedley: true, isSpecial: false },
  ]
  assert.deepEqual(cloneSetlistItems(source, 'concert-2'), [
    { ...source[1], concertId: 'concert-2', position: 1 },
    { ...source[0], concertId: 'concert-2', position: 1 },
  ])
})

test('重复 position 保持原输入先后且不按 createdAt 或 id 重新排序', () => {
  const base = {
    songId: null,
    section: 'MAIN' as const,
    position: 3,
    versionName: null,
    note: null,
    isEncore: false,
    isRequest: false,
    isDebut: false,
    isGuest: false,
    isMedley: false,
    isSpecial: false,
  }
  const result = cloneSetlistItems([
    { ...base, displayName: '第三首' },
    { ...base, displayName: '第二首' },
    { ...base, displayName: '第一首' },
  ], 'concert-new')
  assert.deepEqual(result.map((item) => [item.displayName, item.position]), [
    ['第三首', 1],
    ['第二首', 2],
    ['第一首', 3],
  ])
  const helper = read('lib/music-concert-admin.ts')
  assert.doesNotMatch(helper, /sortableTimestamp|item\.createdAt|item\.id/)
})

test('创建、编辑与复制歌单统一归一化 position 并保留稳定查询顺序', () => {
  const createRoute = read('app/api/admin/music/concerts/route.ts')
  const editRoute = read('app/api/admin/music/concerts/[concertId]/route.ts')
  const copyRoute = read('app/api/admin/music/concerts/copy-city/route.ts')
  assert.match(createRoute, /cloneSetlistItems\(inheritedItems, concert\.id\)/)
  assert.match(editRoute, /cloneSetlistItems\(setlistItems, concertId\)/)
  assert.match(copyRoute, /cloneSetlistItems\(source\.MusicConcertSetlistItem/)
  assert.match(createRoute, /MusicConcertSetlistItem: \{ orderBy: \[\{ position: 'asc' \}\] \}/)
  assert.match(copyRoute, /MusicConcertSetlistItem: \{ orderBy: \[\{ position: 'asc' \}\] \}/)
  assert.match(editRoute, /position: 'asc'[\s\S]{0,100}createdAt: 'asc'[\s\S]{0,100}id: 'asc'/)
})

test('城市详情日期范围来自当前城市场次而不是巡演起止时间', () => {
  const cityPage = read('app/music/live/tours/[tourId]/[city]/page.tsx')
  assert.match(cityPage, /const cityStartDate = cityConcerts\[0\]\?\.concertDate \?\? null/)
  assert.match(cityPage, /const cityEndDate = cityConcerts\.at\(-1\)\?\.concertDate \?\? cityStartDate/)
  assert.match(cityPage, /formatLiveDateRange\(cityStartDate, cityEndDate\)/)
  assert.doesNotMatch(cityPage, /formatLiveDateRange\(meta\.startDate, meta\.endDate\)/)
  assert.doesNotMatch(cityPage, /posterUrl: true, startDate: true, endDate: true/)
})

test('前台场次始终按日期、创建时间和 id 排序且不受后台 sortOrder 污染', () => {
  const publicSources = [
    'app/music/concerts/page.tsx',
    'app/music/concerts/[concertId]/page.tsx',
    'app/music/live/tours/[tourId]/page.tsx',
    'app/music/live/tours/[tourId]/[city]/page.tsx',
    'app/api/music/live/tours/[tourId]/route.ts',
    'lib/music-archive.ts',
  ].map(read)
  for (const source of publicSources) {
    assert.match(source, /orderBy: \[\{ concertDate: 'asc' \}(?:, \{ startTime: 'asc' \})?, \{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/)
    assert.doesNotMatch(source, /orderBy: \[\{ sortOrder: 'asc' \}, \{ concertDate: 'asc' \}/)
  }
})

test('巡演城市聚合结果按每个城市第一场演出日期排序', () => {
  const page = read('app/music/live/tours/[tourId]/page.tsx')
  const route = read('app/api/music/live/tours/[tourId]/route.ts')
  for (const source of [page, route]) {
    assert.match(source, /firstDate:/)
    assert.match(source, /left\.firstDate(?:\.toISOString\(\)\.slice\(0, 10\))?\.localeCompare\(right\.firstDate/)
    assert.doesNotMatch(source, /\.sort\(\(left, right\) => left\.city\.localeCompare/)
  }
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

test('后台排序使用现有 sortOrder，海报保存不会被编辑请求清空', () => {
  const reorder = read('app/api/admin/music/concerts/reorder/route.ts')
  const itemRoute = read('app/api/admin/music/concerts/[concertId]/route.ts')
  const editor = read('app/admin/music/concerts/[concertId]/AdminConcertEditor.tsx')
  const coverRoute = read('app/api/admin/music/covers/route.ts')
  assert.match(reorder, /data: \{ sortOrder: sortIndex \+ 1 \}/)
  assert.match(reorder, /direction === 'down'/)
  assert.match(editor, /posterUrl: ''/)
  assert.match(editor, /posterUrl: item\.posterUrl \|\| ''/)
  assert.match(editor, /setForm\(\(current\) => \(\{ \.\.\.current, posterUrl \}\)\)/)
  assert.match(itemRoute, /hasPosterUrl/)
  assert.match(coverRoute, /musicConcert\.update\(\{ where: \{ id: entityId \}, data: \{ posterUrl: url \} \}\)/)
})

test('后台多选日期可添加标签和删除且不再提供手填场次编号', () => {
  const manager = read('app/admin/music/concerts/AdminConcertManager.tsx')
  const picker = read('components/music/live/MultiDatePicker.tsx')
  const createRoute = read('app/api/admin/music/concerts/route.ts')
  const editor = read('app/admin/music/concerts/[concertId]/AdminConcertEditor.tsx')
  assert.match(manager, /concertDates/)
  assert.match(manager, /演出日期（点击多选，可切换月份）/)
  assert.match(manager, /<MultiDatePicker value={concertDates} onChange={setConcertDates}/)
  assert.match(picker, /aria-label={`取消 \$\{date\}`}/)
  assert.match(picker, /aria-label="选择年份"/)
  assert.match(picker, /aria-label="选择月份"/)
  assert.match(picker, /YEAR_OPTIONS/)
  assert.match(manager, /使用上一场歌单/)
  assert.match(manager, /创建新歌单/)
  assert.match(manager, /startCityConcert\(city: string\)/)
  assert.match(manager, /tourId: browseTourId, city/)
  assert.match(manager, />新增场次</)
  assert.match(manager, /posterUrl: form\.posterUrl/)
  assert.match(manager, /form\.status/)
  assert.match(createRoute, /posterUrl: toPublicMediaUrl\(sanitizeText\(body\?\.posterUrl, 1000\)\)/)
  assert.match(editor, /mode=copy-options/)
  assert.match(editor, /sessionNumber\?: string \| null/)
  assert.match(editor, /选择当前巡演其他场次复制歌单/)
  assert.match(editor, /Encore 编辑器/)
  assert.match(editor, /setEncoreSetlist/)
  assert.match(editor, /normalizeSetlistRows\(item\.setlist, false\)/)
  assert.match(editor, /normalizeSetlistRows\(item\.setlist, true\)/)
  assert.match(manager, /setlistSource: 'SOURCE'/)
  assert.match(manager, /sourceConcertId/)
  assert.match(manager, /mode=copy-options&tourId=/)
  assert.doesNotMatch(manager, />场次编号<input/)
})

test('任意场次歌单复制选项不受后台 200 条平铺上限影响', () => {
  const route = read('app/api/admin/music/concerts/route.ts')
  const editor = read('app/admin/music/concerts/[concertId]/AdminConcertEditor.tsx')
  assert.match(route, /if \(mode === 'copy-options'\)/)
  assert.match(route, /MusicTour: \{ select: \{ id: true, name: true \} \}/)
  assert.match(route, /sessionNumber: true/)
  assert.match(route, /sortOrder: true/)
  assert.match(route, /excludeId \? \{ id: \{ not: excludeId \} \} : \{\}/)
  assert.match(route, /where: \{ id: sourceConcertId, tourId \}/)
  assert.match(route, /setlistSource === 'SOURCE'/)
  assert.match(editor, /sourceConcertId/)
  assert.match(read('app/admin/music/concerts/AdminConcertManager.tsx'), /sourceConcertId: form\.sourceConcertId/)
  assert.match(editor, /excludeId=\$\{encodeURIComponent\(concertId\)\}/)
  assert.match(editor, /row\.tour\.name\} · \{row\.city\} · \{row\.concertDate\.slice\(0, 10\)\}/)
})

test('前台巡演详情展示地区、场次序号、场馆和歌单', () => {
  const page = read('app/music/concerts/[concertId]/page.tsx')
  assert.match(page, /共 \{tour\.MusicConcert\.length\} 场/)
  assert.match(page, /concert\.sessionNumber/)
  assert.match(page, /concert\.venue/)
  assert.match(page, /concert\.MusicConcertSetlistItem\.map/)
})
