import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getNextHeroSortOrder, moveHeroSlide, sortHeroSlides } from '../lib/hero-order'
import type { SiteHeroSlide } from '../lib/site-config'

const read = (path: string) => readFileSync(path, 'utf8')

function slide(title: string, sortOrder: number, isVisible = true): SiteHeroSlide {
  return {
    title,
    subtitle: '',
    buttonText: '',
    href: '#',
    imageUrl: '',
    isVisible,
    sortOrder,
  }
}

test('Hero 上移/下移交换相邻项并保持连续 sortOrder', () => {
  const initial = [slide('A', 1), slide('B', 2), slide('C', 3)]
  const up = moveHeroSlide(initial, 1, 'up')
  assert.equal(up.moved, true)
  assert.deepEqual(up.slides.map((item) => item.title), ['B', 'A', 'C'])
  assert.deepEqual(up.slides.map((item) => item.sortOrder), [1, 2, 3])

  const down = moveHeroSlide(up.slides, 0, 'down')
  assert.equal(down.moved, true)
  assert.deepEqual(down.slides.map((item) => item.title), ['A', 'B', 'C'])
})

test('Hero 首尾移动是无操作，禁用项不会破坏全量排序', () => {
  const initial = [slide('A', 10), slide('B', 20), slide('C', 30, false)]
  assert.equal(moveHeroSlide(initial, 0, 'up').moved, false)
  assert.equal(moveHeroSlide(initial, 2, 'down').moved, false)
  assert.deepEqual(sortHeroSlides(initial).map((item) => item.title), ['A', 'B', 'C'])
  assert.equal(getNextHeroSortOrder(initial), 31)
})

test('后台和首页使用同一 sortOrder 排序语义，移动接口服务端事务锁定并持久化', () => {
  const manager = read('app/admin/home/HomeHeroManager.tsx')
  const moveRoute = read('app/api/admin/home/hero/move/route.ts')
  const saveRoute = read('app/api/admin/home/hero/route.ts')
  const home = read('components/HomeHero.tsx')

  assert.match(manager, /上移/)
  assert.match(manager, /下移/)
  assert.match(manager, /index === 0/)
  assert.match(manager, /index === slides\.length - 1/)
  assert.match(manager, /getNextHeroSortOrder\(current\)/)
  assert.match(manager, /\/api\/admin\/home\/hero\/move/)
  assert.match(moveRoute, /requireAdmin\('home_manage'\)/)
  assert.match(moveRoute, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(moveRoute, /FOR UPDATE/)
  assert.match(moveRoute, /moveHeroSlide\(current\.heroSlides, index, direction\)/)
  assert.doesNotMatch(moveRoute, /body\?\.sortOrder/)
  assert.match(saveRoute, /sortHeroSlides\(normalizeSlides\(body\?\.slides\)\)/)
  assert.match(home, /sortHeroSlides\(slides\.filter\(\(item\) => item\.isVisible\)\)/)
})
