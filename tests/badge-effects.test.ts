import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('BadgeImage has separate visual layers for shine, glow and sparkle', () => {
  const component = read('components/UserDisplayName.tsx')
  const css = read('app/globals.css')
  assert.match(component, /badge-visual/)
  assert.match(component, /badge-visual-shine/)
  assert.match(component, /badge-visual-sparkles/)
  assert.match(component, /effectType === 'SPARKLE'/)
  assert.match(component, /effectType === 'SHINE'/)
  assert.match(css, /\.badge-effect-shine \.badge-visual-shine/)
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

test('shine follows the transparent PNG alpha and never paints a rectangular effect layer', () => {
  const component = read('components/UserDisplayName.tsx')
  const css = read('app/globals.css')
  assert.match(component, /className="badge-visual-shine"/)
  assert.match(component, /aria-hidden="true" className="badge-visual-shine"/)
  assert.match(css, /\.badge-visual-shine \{[\s\S]*object-fit:contain[\s\S]*clip-path:polygon[\s\S]*filter:brightness[\s\S]*drop-shadow/)
  assert.match(css, /\.badge-visual \{[\s\S]*border:0[\s\S]*background:transparent[\s\S]*box-shadow:none/)
  assert.doesNotMatch(css, /\.badge-visual-shine \{[^}]*background:linear-gradient/)
  assert.doesNotMatch(css, /\.badge-visual-shine \{[^}]*border-radius:/)
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
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.badge-effect-shine \.badge-visual-shine[\s\S]*animation:none/)
  assert.match(css, /\.badge-effect-glow \.user-badge-image[\s\S]*animation:none[\s\S]*filter:drop-shadow/)
  assert.match(css, /\.badge-museum-item:not\(\.is-obtained\) \.badge-visual\.badge-effect-sparkle \.badge-visual-sparkles i[\s\S]*animation:none/)
})

test('failed images use the neutral placeholder and do not inherit a real badge effect', () => {
  const component = read('components/UserDisplayName.tsx')
  assert.match(component, /if \(!hasImage\) return <span className=\{`user-badge-placeholder/)
  assert.doesNotMatch(component, /user-badge-placeholder[^\n]*badgeEffectClass/)
})
