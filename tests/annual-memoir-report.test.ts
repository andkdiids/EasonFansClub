import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { describeMemoirPage } from '../lib/annual-memoir-art'

const read = (path: string) => readFileSync(path, 'utf8')

test('report is created once under the configuration lock and never recalculated on read', () => {
  const service = read('lib/annual-memoir-report.ts')
  assert.match(service, /FOR UPDATE[\s\S]*userId_year[\s\S]*if \(existing\) return[\s\S]*await collect/)
  assert.match(service, /annualMemoirSnapshot\.create/)
  assert.doesNotMatch(service, /annualMemoirSnapshot\.(update|upsert)/)
  assert.match(service, /where: \{ activityId, userId \}/)
})

test('report route derives owner from the session and requires a separate confirmed write', () => {
  const api = read('app/api/activities/[activityId]/annual-memoir/route.ts')
  const get = api.slice(api.indexOf('function GET'), api.indexOf('function POST'))
  assert.match(get, /readMemoir\(.*user.id\)/)
  assert.doesNotMatch(get, /generateMemoir/)
  assert.match(api, /confirmed !== true/)
})

test('reader displays the ten named chapters and renders the frozen memory and three game metrics', () => {
  const reader = read('lib/annual-memoir-art.ts')
  for (const chapter of ['初次见面', '日子有功', '有话好说', '最佳损友', '念念不忘', '游戏人间', '闪闪发光', '我们万岁', '年度身份', '明年今日']) assert.ok(reader.includes(chapter))
  assert.doesNotMatch(reader, /firstRecordedDay|年度首个社区记录/)
  assert.doesNotMatch(reader, /好久不见|followers/)
  assert.doesNotMatch(read('lib/annual-memoir-report.ts'), /listening|playCount/i)
  const report = { nickname: '阿晴', uid: 42, registered: '2026-08-01', title: '故事记录者', message: '',
    communityMemory: { kind: 'POST' as const, excerpt: '散场后一起哼歌', date: '2026-08-30' },
    bestGame: { score: 128, mode: '粤语残片' }, monthlyFirsts: 1, weeklyFirsts: 3, topics: 2, offlineMeetups: 0 }
  assert.match(describeMemoirPage(report, 4), /一篇帖子。散场后一起哼歌。2026 年 8 月 30 日/)
  assert.match(describeMemoirPage({ ...report, communityMemory: null }, 4), /有些想说的话/)
  assert.match(describeMemoirPage(report, 5), /最高单局分数 128。粤语残片。月度第一 1。周度第一 3/)
  assert.match(describeMemoirPage({ ...report, monthlyFirsts: null, weeklyFirsts: null }, 5), /月度第一 —。周度第一 —/)
  assert.match(describeMemoirPage(report, 7), /参与过的话题活动 2 场。和大家线下见面 0 次/)
  assert.match(describeMemoirPage({ ...report, offlineMeetups: undefined }, 7), /和大家线下见面 — 次/)
})
