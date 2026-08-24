import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('BadgeImage has separate visual layers for shine, glow and sparkle', () => {
  const component = read('components/UserDisplayName.tsx')
  const css = read('app/globals.css')
  assert.match(component, /badge-visual/)
  assert.match(component, /badge-shimmer-clip/)
  assert.match(component, /badge-shimmer-layer/)
  assert.match(component, /badge-visual-sparkles/)
  assert.match(component, /effectType === 'SPARKLE'/)
  assert.match(component, /effectType === 'SHINE'/)
  assert.match(css, /\.badge-effect-shine \.badge-shimmer-clip/)
  assert.match(css, /\.badge-effect-shine \.badge-shimmer-layer/)
  assert.match(css, /\.badge-effect-shine \.user-badge-image[\s\S]*animation:eason-badge-shine-fallback 4s ease-in-out infinite/)
  assert.match(css, /\.badge-effect-glow \.user-badge-image/)
  assert.match(css, /\.badge-visual-sparkles i/)
  assert.match(css, /@keyframes eason-badge-shine/)
  assert.match(css, /@keyframes eason-badge-glow/)
  assert.match(css, /@keyframes eason-badge-sparkle/)
})

test('BadgeName applies badge animationEffect without coupling it to nicknameEffect', () => {
  const component = read('components/UserDisplayName.tsx')
  assert.match(component, /export function BadgeName/)
  assert.match(component, /badgeNameEffectClass/)
  assert.match(component, /nicknameEffectClass/)
  assert.match(component, /displayBadge\?\.nicknameEffect === 'GOLD'/)
  assert.match(component, /<BadgeName badge=\{displayBadge\}/)
  assert.match(read('components/BadgeExhibitionHall.tsx'), /<BadgeName badge=\{badge\}/)
  assert.match(read('components/BadgeCollectionPanel.tsx'), /<BadgeName badge=\{badge\}/)
  assert.match(read('components/BadgeMiniShowcase.tsx'), /<BadgeName badge=\{item\}/)
})

test('nickname GOLD, GRADIENT and GLOW have visible text-level contracts and safe fallbacks', () => {
  const component = read('components/UserDisplayName.tsx')
  const css = read('app/globals.css')
  assert.match(component, /user-nickname-effect-gold/)
  assert.match(component, /user-nickname-effect-gradient/)
  assert.match(component, /user-nickname-effect-glow/)
  assert.match(component, /--badge-gradient-start/)
  assert.match(component, /--badge-gradient-end/)
  assert.match(component, /--badge-name-fallback/)
  assert.match(component, /0 0 4px currentColor/)
  assert.match(css, /\.user-display-name-text-gradient[\s\S]*-webkit-text-fill-color:transparent/)
  assert.match(css, /\.user-nickname-effect-gold[\s\S]*background-image:linear-gradient/)
  assert.match(css, /\.user-nickname-effect-gradient[\s\S]*background-image:linear-gradient/)
  assert.match(css, /\.user-nickname-effect-glow[\s\S]*text-shadow/)
})

test('shine uses one fixed PNG plus a masked CSS gradient that moves with transform', () => {
  const component = read('components/UserDisplayName.tsx')
  const css = read('app/globals.css')
  assert.match(component, /className="badge-shimmer-clip"/)
  assert.match(component, /className="badge-shimmer-layer"/)
  assert.match(component, /className="user-badge-image"/)
  assert.equal((component.match(/className="user-badge-image"/g) || []).length, 1)
  assert.match(component, /--badge-shine-mask/)
  assert.match(css, /\.badge-shimmer-clip \{[\s\S]*overflow:hidden[\s\S]*opacity:1/)
  assert.match(css, /\.badge-shimmer-layer \{[\s\S]*background:linear-gradient[\s\S]*transform:translate3d\(-45%,0,0\)/)
  assert.match(css, /-webkit-mask-image:var\(--badge-shine-mask\)/)
  assert.match(css, /mask-image:var\(--badge-shine-mask\)/)
  assert.match(css, /\.badge-visual \{[\s\S]*border:0[\s\S]*background:transparent[\s\S]*box-shadow:none/)
  assert.match(css, /@keyframes eason-badge-shine[\s\S]*transform:translate3d\(-45%,0,0\)/)
  assert.match(css, /@keyframes eason-badge-shine-fallback[\s\S]*filter:drop-shadow/)
  assert.match(css, /animation:eason-badge-shine 4s ease-in-out infinite; animation-play-state:running/)
  assert.doesNotMatch(css, /@keyframes eason-badge-shine[^}]*mask-position/)
  assert.doesNotMatch(css, /@property[^}]*badge-shine/)
  assert.doesNotMatch(component, /<img[^>]+badge-visual-shine/)
})

test('badge focus state never adds a rectangular outline around the image wrapper', () => {
  const css = read('app/globals.css')
  assert.match(css, /\.user-display-badge:focus-visible \{[^}]*outline:none/)
})

test('museum and mini showcase keep GLOW on the badge image instead of the shelf item', () => {
  const css = read('app/globals.css')
  assert.match(css, /\.badge-museum-item-image \.badge-visual\.badge-effect-glow \.user-badge-image,\n\.badge-mini-showcase-image \.badge-visual\.badge-effect-glow \.user-badge-image \{[\s\S]*animation:eason-badge-glow/)
  assert.doesNotMatch(css, /\.badge-museum-item[^}]*box-shadow:[^n]/)
})

test('effects keep their envelope visible, reduce motion without disappearing, and downgrade unearned museum badges', () => {
  const css = read('app/globals.css')
  assert.match(css, /\.badge-visual[\s\S]*overflow:visible/)
  assert.match(css, /\.badge-museum-cabinet \{ overflow:visible; \}/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.badge-effect-shine \.badge-shimmer-layer[\s\S]*animation:none/)
  assert.match(css, /\.badge-effect-glow \.user-badge-image[\s\S]*animation:none[\s\S]*filter:drop-shadow/)
  assert.match(css, /\.badge-museum-item:not\(\.is-obtained\) \.badge-visual\.badge-effect-sparkle \.badge-visual-sparkles i[\s\S]*animation:none/)
})

test('failed images use the neutral placeholder and do not inherit a real badge effect', () => {
  const component = read('components/UserDisplayName.tsx')
  assert.match(component, /if \(!hasImage\) return <span className=\{`user-badge-placeholder/)
  assert.doesNotMatch(component, /user-badge-placeholder[^\n]*badgeEffectClass/)
})
