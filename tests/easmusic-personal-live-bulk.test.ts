import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseBulkAttendanceRequest } from '../lib/music-live-bulk'

const read = (path: string) => readFileSync(path, 'utf8')

test('批量观演请求会去重并拒绝同场新增和移除', () => {
  assert.deepEqual(parseBulkAttendanceRequest({ addShowIds: ['show-1', 'show-1'], removeShowIds: [] }).data, {
    tourId: undefined,
    addShowIds: ['show-1'],
    removeShowIds: [],
  })
  assert.equal(parseBulkAttendanceRequest({ addShowIds: ['show-1'], removeShowIds: ['show-1'] }).data, undefined)
})

test('批量 API 只处理公开场次并在事务中幂等保存', () => {
  const source = read('app/api/music/live/attendance/bulk/route.ts')
  assert.match(source, /requireUser\(\)/)
  assert.match(source, /status: 'PUBLISHED'/)
  assert.match(source, /MusicTour: tourId \? \{ id: tourId, status: 'PUBLISHED' \}/)
  assert.match(source, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(source, /createMany\([\s\S]*skipDuplicates: true/)
  assert.match(source, /deleteMany\([\s\S]*userId: guard\.user\.id[\s\S]*concertId: \{ in: removeShowIds \}/)
  assert.match(source, /addShowIds|removeShowIds/)
})

test('My Live 提供单入口、城市折叠、全选和已添加状态', () => {
  const dashboard = read('components/music/live/MyLiveDashboard.tsx')
  const panel = read('components/music/live/BatchAttendancePanel.tsx')
  assert.match(dashboard, /批量添加场次/)
  assert.match(dashboard, /BatchAttendancePanel/)
  assert.match(panel, /搜索城市 \/ 场馆 \/ 日期/)
  assert.match(panel, /expandedCities/)
  assert.match(panel, /全选/)
  assert.match(panel, /已添加/)
  assert.match(panel, /本次新增/)
  assert.ok(panel.includes('/api/music/live/attendance/bulk'))
  assert.match(panel, /addShowIds, removeShowIds/)
  assert.match(panel, /sticky bottom-0/)
})

test('具体巡演入口把当前巡演范围传给 My Live', () => {
  assert.ok(read('app/music/live/tours/[tourId]/page.tsx').includes('/music/live/me?tourId=${encodeURIComponent(tour.id)}'))
  assert.match(read('app/music/live/me/page.tsx'), /batchTourId=\{tourId\?\.trim\(\) \|\| undefined\}/)
})
