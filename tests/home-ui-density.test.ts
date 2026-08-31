import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('post detail images use one stable horizontal carousel without enlarging small images', () => {
  const postPage = read('app/posts/[postId]/page.tsx')
  const carousel = read('components/PostMediaCarousel.tsx')
  const css = read('app/globals.css')

  assert.match(postPage, /<PostMediaCarousel/)
  assert.match(carousel, /currentIndex/)
  assert.match(carousel, /scrollTo\(/)
  assert.match(css, /\.post-media-carousel-viewport \{[^}]*scroll-snap-type:x mandatory/)
  assert.match(css, /\.post-media-carousel-image \{[^}]*object-fit:contain/)
})

test('notification cards use compact flow layout while retaining shared rendering', () => {
  const notifications = read('app/notifications/NotificationsClient.tsx')

  assert.match(notifications, /notification-list-item group flex min-w-0 gap-2 rounded-sm border p-2\.5 transition sm:gap-2\.5 sm:p-3/)
  assert.match(notifications, /<div className="mt-1 flex flex-wrap items-center justify-between gap-1\.5 pt-1">/)
  assert.doesNotMatch(notifications, /<div className="mt-auto flex flex-wrap items-center justify-between/)
  assert.match(notifications, /<section className="notification-center space-y-3">/)
})

test('home module entry links share the >> label and no-movement hover rule', () => {
  const home = read('components/HomeLayoutSurface.tsx')
  const css = read('app/globals.css')
  const entryCount = home.match(/className="home-module-entry"/g) || []
  const markerCount = home.match(/\{'>>'\}/g) || []

  assert.equal(entryCount.length, 6)
  assert.equal(markerCount.length, 6)
  assert.match(home, /homeText\.activitiesMore[^\n]*\{'>>'\}<\/Link>/)
  assert.match(home, /homeText\.salonMore[^\n]*\{'>>'\}<\/Link>/)
  assert.match(css, /\.community-panel > header a\.home-module-entry:hover,[\s\S]*\.community-panel > header a\.home-module-entry:focus-visible/)

  const entryRule = css.match(/\.community-panel > header a\.home-module-entry \{([\s\S]*?)\}/)?.[1] || ''
  assert.ok(entryRule)
  assert.doesNotMatch(entryRule, /transform\s*:/)
})
