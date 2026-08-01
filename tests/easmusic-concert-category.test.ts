import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('MusicTour 使用正式演唱会分类且旧数据默认 MAIN', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model MusicTour \{[\s\S]*category\s+ConcertCategory\s+@default\(MAIN\)/)
  assert.match(schema, /enum ConcertCategory \{\s+MAIN\s+SMALL\s+GUEST\s+\}/)

  const migration = read('prisma/migrations/20260802013000_add_concert_category/migration.sql')
  assert.match(migration, /ADD COLUMN `category` ENUM\('MAIN', 'SMALL', 'GUEST'\) NOT NULL DEFAULT 'MAIN'/)
  assert.doesNotMatch(migration, /DROP|DELETE|TRUNCATE|RENAME/)
})

test('巡演后台可创建、编辑并显示正式分类', () => {
  const manager = read('app/admin/music/tours/AdminTourManager.tsx')
  assert.match(manager, /category: 'MAIN'/)
  assert.match(manager, /演唱会分类/)
  for (const category of ['MAIN', 'SMALL', 'GUEST']) assert.match(manager, new RegExp(`option value="${category}"`))
  assert.match(manager, /categoryLabels\[tour\.category\]/)

  for (const path of ['app/api/admin/music/tours/route.ts', 'app/api/admin/music/tours/[tourId]/route.ts']) {
    const route = read(path)
    assert.match(route, /parseConcertCategory/)
    assert.match(route, /演唱会分类无效/)
    assert.match(route, /category,/)
  }
})

test('前台只按 category 分类且不再猜测巡演名称', () => {
  const timeline = read('components/music/MusicConcertTimeline.tsx')
  assert.match(timeline, /tour\.category === 'MAIN'/)
  assert.match(timeline, /tour\.category === 'SMALL'/)
  assert.match(timeline, /tour\.category === 'GUEST'/)
  assert.doesNotMatch(timeline, /SMALL_CONCERT_NAMES|normalizeName|name\.includes|slice\(0, 7\)/)
  assert.match(timeline, /暂未收录/)
})

test('MY LIVE 使用扁平档案样式而非玻璃拟态', () => {
  const css = read('app/globals.css')
  const panelRule = css.match(/\.music-concert-gallery-my-live \{([^}]*)\}/)?.[1] || ''
  assert.match(panelRule, /border-radius:4px/)
  assert.doesNotMatch(panelRule, /box-shadow|backdrop-filter|gradient|blur|inset/)
  assert.doesNotMatch(css, /music-concert-gallery-my-live::(?:before|after)/)
  assert.doesNotMatch(css, /music-concert-gallery-my-live-head/)
})
