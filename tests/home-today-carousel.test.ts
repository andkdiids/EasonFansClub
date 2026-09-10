import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getHomeTodayPageCount, getHomeTodayPageItems, normalizeHomeTodayIndex } from '../lib/home-today'

const read = (path: string) => readFileSync(path, 'utf8')

test('今日模块按两条一页切分，最后一页保留真实的一条内容', () => {
  const items = ['A', 'B', 'C', 'D', 'E']

  assert.equal(getHomeTodayPageCount(0), 0)
  assert.equal(getHomeTodayPageCount(1), 1)
  assert.equal(getHomeTodayPageCount(2), 1)
  assert.equal(getHomeTodayPageCount(3), 2)
  assert.equal(getHomeTodayPageCount(4), 2)
  assert.equal(getHomeTodayPageCount(5), 3)
  assert.deepEqual(getHomeTodayPageItems(items, 0).items, ['A', 'B'])
  assert.deepEqual(getHomeTodayPageItems(items, 1).items, ['C', 'D'])
  assert.deepEqual(getHomeTodayPageItems(items, 2).items, ['E'])
  assert.equal(getHomeTodayPageItems(items, 2).pageIndex, 2)
})

test('今日模块在数据数量变化或快速切换时不会产生越界空页', () => {
  assert.equal(normalizeHomeTodayIndex(4, 5, 2), 1)
  assert.equal(normalizeHomeTodayIndex(2, 3, 2), 0)
  assert.equal(normalizeHomeTodayIndex(-1, 5, 2), 2)
  assert.equal(getHomeTodayPageItems(['A', 'B', 'C'], 9).items.length, 1)
  assert.deepEqual(getHomeTodayPageItems(['A', 'B', 'C'], 9).items, ['C'])
})

test('首页今日模块区分尚未加载与真正的空历史记录，并将分页器独立到 footer', () => {
  const surface = read('components/HomeLayoutSurface.tsx')
  const css = read('app/globals.css')

  assert.match(surface, /todayEventsLoaded/)
  assert.match(surface, /todayEventsLoaded \? <p className="community-empty home-today-empty"/)
  assert.match(surface, /home-today-content-viewport/)
  assert.match(surface, /home-today-pagination-footer/)
  assert.doesNotMatch(surface, /setTodayEvents\(\[\]\)/)
  assert.match(css, /\.home-first-row-panel \.home-today-content-viewport[\s\S]*flex: 1 1 auto/)
  assert.match(css, /\.home-today-pagination-footer[\s\S]*margin-top: auto/)
  assert.match(css, /\.home-first-row-panel \.home-today-pagination-footer[\s\S]*flex-shrink: 0/)
})
