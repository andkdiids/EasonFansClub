import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const center = read('app/admin/review/ReviewCenter.tsx')
const centerPage = read('app/admin/review/page.tsx')
const route = read('app/api/admin/review/route.ts')

test('统一审核中心默认选中并请求待审核（PENDING）', () => {
  assert.match(center, /useState<Filter>\('PENDING'\)/)
  assert.match(center, /status: nextStatus/)
  assert.match(route, /: 'PENDING'/)
  assert.match(centerPage, /ReviewCenter initialType=/)
})

test('切换任一状态 Tab 均按该状态重新拉取列表', () => {
  assert.match(center, /setStatus\(value\)/)
  assert.match(center, /status: nextStatus/)
  assert.match(route, /statusParam === 'ALL' \|\| reviewStatuses\.includes/)
  assert.match(center, /cache: 'no-store'/)
  assert.match(route, /Cache-Control': 'private, no-store, max-age=0'/)
})

test('挂载时若初始列表与当前 Tab 不一致会按当前状态重拉，避免复用上一轮 Tab 数据', () => {
  assert.match(center, /useEffect\(\(\) => \{ void load\(\) \}, \[load\]\)/)
  assert.match(center, /const params = new URLSearchParams\(\{ type: queryType\(nextType\), status: nextStatus, page: '1' \}\)/)
})

test('统一审核中心的三种审核状态均可作为 Tab 切换目标', () => {
  assert.match(center, /\['ALL', 'PENDING', 'APPROVED', 'REJECTED'\]/)
  assert.match(center, /PENDING: '待审核', APPROVED: '已通过', REJECTED: '未通过'/)
})
