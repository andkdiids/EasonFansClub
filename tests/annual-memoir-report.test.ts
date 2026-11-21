import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

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

test('reader displays the ten named chapters and uses retained follow records for page five', () => {
  const reader = read('app/activities/[activityId]/annual-memoir/MemoirReader.tsx')
  for (const chapter of ['初次见面', '日子有功', '有话好说', '最佳损友', '好久不见', '游戏人间', '闪闪发光', '我们万岁', '年度身份', '明年今日']) assert.ok(reader.includes(chapter))
  assert.match(reader, /好久不见.*report.followers/)
  assert.doesNotMatch(read('lib/annual-memoir-report.ts'), /listening|playCount/i)
})
