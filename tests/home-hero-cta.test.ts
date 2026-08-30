import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveHomeHeroCopy } from '../components/HomeHero'

const read = (path: string) => readFileSync(path, 'utf8')

test('Hero resolves title and CTA visibility from the active slide without state leakage', () => {
  const hero = read('components/HomeHero.tsx')
  assert.match(hero, /const active = visibleSlides\[index\] \|\| visibleSlides\[0\] \|\| null/)
  assert.match(hero, /resolveHomeHeroCopy\(active, defaultTitle, defaultSubtitle\)/)
  assert.match(hero, /const buttonText = active\?\.buttonText\?\.trim\(\) \|\| ''/)
  assert.match(hero, /const buttonHref = active\?\.href\?\.trim\(\) \|\| ''/)
  assert.match(hero, /showTitle: \(active\?\.showTitle !== false\) && Boolean\(title\)/)
  assert.match(hero, /showButton: Boolean\(active\) && active\?\.showButton !== false && Boolean\(buttonText\) && Boolean\(buttonHref\)/)
  assert.doesNotMatch(hero, /defaultHeroButton/)
  assert.doesNotMatch(hero, /buttonText = active\?\.buttonText \|\|/)
})

test('Hero slide combinations match the product display contract', () => {
  const hero = read('components/HomeHero.tsx')
  const home = read('components/HomeLayoutSurface.tsx')
  assert.match(hero, /showButton: Boolean\(active\) && active\?\.showButton !== false && Boolean\(buttonText\) && Boolean\(buttonHref\)/)
  assert.match(hero, /showTitle: \(active\?\.showTitle !== false\) && Boolean\(title\)/)
  assert.doesNotMatch(hero, /shareAction/)
  const heroBlock = home.slice(home.indexOf('<HomeHero'), home.indexOf('<div className="community-home-share-action"'))
  assert.doesNotMatch(heroBlock, /分享/)
})

type SlideCopyInput = NonNullable<Parameters<typeof resolveHomeHeroCopy>[0]>

function slideCopy(overrides: Partial<SlideCopyInput> = {}): SlideCopyInput {
  return { title: '', subtitle: '', buttonText: '', href: '', ...overrides }
}

test('configured CTA, empty CTA, title-only and button-only slides resolve independently', () => {
  const configured = resolveHomeHeroCopy(slideCopy({ title: '进入活动', buttonText: '查看活动', href: '/activities' }))
  const empty = resolveHomeHeroCopy(slideCopy())
  const titleOnly = resolveHomeHeroCopy(slideCopy({ title: '只有标题' }))
  const buttonOnly = resolveHomeHeroCopy(slideCopy({ buttonText: '进入广场', href: '/forum' }))
  const disabled = resolveHomeHeroCopy(slideCopy({ title: '隐藏按钮', buttonText: '不应出现', href: '/forum', showButton: false }))

  assert.deepEqual({ text: configured.buttonText, show: configured.showButton }, { text: '查看活动', show: true })
  assert.equal(empty.showTitle, false)
  assert.equal(empty.showButton, false)
  assert.equal(titleOnly.showTitle, true)
  assert.equal(titleOnly.showButton, false)
  assert.equal(buttonOnly.showTitle, false)
  assert.equal(buttonOnly.showButton, true)
  assert.equal(disabled.showButton, false)
})
