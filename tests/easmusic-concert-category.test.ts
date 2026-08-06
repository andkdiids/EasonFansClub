import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('MusicTour 保留枚举并新增 categoryId 关联(兼容旧数据)', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model MusicTour \{[\s\S]*category\s+ConcertCategory\s+@default\(MAIN\)/)
  assert.match(schema, /model MusicTour \{[\s\S]*categoryId\s+String\?/)
  assert.match(schema, /enum ConcertCategory \{\s+MAIN\s+SMALL\s+GUEST\s+\}/)

  const migration = read('prisma/migrations/20260802013000_add_concert_category/migration.sql')
  assert.match(migration, /ADD COLUMN `category` ENUM\('MAIN', 'SMALL', 'GUEST'\) NOT NULL DEFAULT 'MAIN'/)
  assert.doesNotMatch(migration, /DROP|DELETE|TRUNCATE|RENAME/)

  const newMigration = read('prisma/migrations/20260806180000_add_tour_category_id/migration.sql')
  assert.match(newMigration, /ADD COLUMN `categoryId`/)
  assert.match(newMigration, /UPDATE `MusicTour` SET `categoryId`/)
  assert.match(newMigration, /FOREIGN KEY/)
})

test('巡演后台动态读取分类(含新增)并可创建、编辑、显示', () => {
  const manager = read('app/admin/music/tours/AdminTourManager.tsx')
  assert.match(manager, /演唱会分类/)
  // 不再写死枚举 option，改为从 categories 动态渲染。
  assert.match(manager, /categories/)
  assert.match(manager, /categoryId/)
  assert.doesNotMatch(manager, /option value="MAIN"/)
  // 仍保留枚举回退兜底（兼容旧数据）。
  assert.match(manager, /category: 'MAIN'/)
  assert.match(manager, /categoryLabels\[tour\.category\]/)

  for (const path of ['app/api/admin/music/tours/route.ts', 'app/api/admin/music/tours/[tourId]/route.ts']) {
    const route = read(path)
    assert.match(route, /parseConcertCategory/)
    assert.match(route, /演唱会分类无效/)
    assert.match(route, /category,/)
    assert.match(route, /categoryId/)
  }
})

test('前台按动态分类(categoryId)展示并保留枚举回退', () => {
  const timeline = read('components/music/MusicConcertTimeline.tsx')
  // 优先按 categoryId 关联分类分组，回退到枚举映射。
  assert.match(timeline, /categoryId/)
  assert.match(timeline, /CONCERT_CATEGORY_ENUM_TO_SLUG/)
  assert.match(timeline, /getEnabledConcertCategories|categories/)
  assert.doesNotMatch(timeline, /tour\.category === 'MAIN'|tour\.category === 'SMALL'|tour\.category === 'GUEST'/)
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
