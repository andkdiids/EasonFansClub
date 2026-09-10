import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildLyricMatchSnippet,
  getPrescriptionHistorySearchTerms,
  normalizePrescriptionHistoryQuery,
  parsePrescriptionHistoryDateQuery,
} from '../lib/prescription-history-search'

const read = (path: string) => readFileSync(path, 'utf8')

test('历史处方日期搜索使用上海当前年份并支持约定格式', () => {
  const now = new Date('2026-09-10T00:30:00.000Z')
  assert.equal(parsePrescriptionHistoryDateQuery('2026-09-10', now), '2026-09-10')
  assert.equal(parsePrescriptionHistoryDateQuery('2026/09/10', now), '2026-09-10')
  assert.equal(parsePrescriptionHistoryDateQuery('09-10', now), '2026-09-10')
  assert.equal(parsePrescriptionHistoryDateQuery('9月10日', now), '2026-09-10')
  assert.equal(parsePrescriptionHistoryDateQuery('2026-02-30', now), null)
})

test('历史处方搜索规范化标题并截取歌词命中片段', () => {
  assert.equal(normalizePrescriptionHistoryQuery('  陀飞 轮  '), '陀飞 轮')
  assert.deepEqual(getPrescriptionHistorySearchTerms('  陀飞 轮  '), ['陀飞 轮', '陀飞轮'])
  const snippet = buildLyricMatchSnippet('谁都只得那双手 靠拥抱亦难任你拥有 这一句之后还有很长的歌词', '拥抱', 4)
  assert.equal(snippet, '…双手 靠拥抱亦难任你…')
  assert.equal(buildLyricMatchSnippet('没有命中', '拥抱'), null)
})

test('历史处方搜索服务端限定用户、快照和关联处方，并分页排序', () => {
  const service = read('lib/entertainment.ts')
  const route = read('app/api/entertainment/daily-draw/history/route.ts')
  const page = read('app/prescription/history/page.tsx')
  const client = read('components/games/PrescriptionHistorySearch.tsx')

  assert.match(service, /userId,\s*OR:/)
  assert.match(service, /songTitle: \{ contains: term \}/)
  assert.match(service, /lyricText: \{ contains: term \}/)
  assert.match(service, /LyricPrescription: \{ is: \{ text: \{ contains: term \} \} \}/)
  assert.match(service, /take: pageSize/)
  assert.match(service, /orderBy: \[\{ dateKey: 'desc' \}/)
  assert.match(service, /LyricPrescription:\s*\{\s*select:/)
  assert.match(route, /const guard = await requireUser\(\)/)
  assert.match(route, /getEntertainmentDailyDrawHistory\(guard\.user\.id/)
  assert.doesNotMatch(route, /params\.get\(['"]userId['"]\)/)
  assert.match(page, /parsePrescriptionHistoryDateQuery/)
  assert.match(page, /initialQuery=\{initialSearchQuery\}/)
  assert.match(client, /placeholder="搜索日期、歌名或歌词"/)
  assert.match(client, /type="date"/)
  assert.match(client, /AbortController/)
  assert.match(client, /setTimeout\(\(\) =>/)
  assert.match(client, /getSearchResultHref\(record\.dateKey\)/)
  assert.match(client, /没有找到相关历史处方/)
})
