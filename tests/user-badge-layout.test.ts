import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('shared identity cards put the equipped badge on its own content row', () => {
  const component = read('components/UserDisplayName.tsx')
  const css = read('app/globals.css')
  const badgeCss = css.slice(css.indexOf('/* E院勋章'))

  assert.match(component, /const stackedBadge = Boolean\(displayBadge && showBadgeName && !compact && showBadgeIcon\)/)
  assert.match(component, /user-display-name-nickname-row/)
  assert.match(component, /user-display-badge-row/)
  assert.match(component, /\{badge\.name\}/)
  assert.match(badgeCss, /\.user-display-name-stacked \{[^}]*flex-direction:column/)
  assert.match(badgeCss, /\.user-display-badge-row \{[^}]*display:flex[^}]*width:100%/)
  assert.match(badgeCss, /\.user-display-badge-row \.badge-visual,.user-display-badge-row \.user-badge-placeholder \{ flex:0 0 auto; \}/)

  const visibleBadgeNameRule = badgeCss.match(/\.user-display-badge-name \{[^}]*\}/)?.[0] || ''
  assert.match(visibleBadgeNameRule, /flex:1 1 auto/)
  assert.match(visibleBadgeNameRule, /min-width:0/)
  assert.match(visibleBadgeNameRule, /overflow:visible/)
  assert.match(visibleBadgeNameRule, /white-space:normal/)
  assert.doesNotMatch(visibleBadgeNameRule, /text-overflow:\s*ellipsis/)
  assert.doesNotMatch(visibleBadgeNameRule, /line-clamp/)

  const visibleBadgeNameChildRule = badgeCss.match(/\.user-display-badge-name \.badge-name-display \{[^}]*\}/)?.[0] || ''
  assert.match(visibleBadgeNameChildRule, /overflow:visible/)
  assert.match(visibleBadgeNameChildRule, /white-space:normal/)
  assert.doesNotMatch(visibleBadgeNameChildRule, /text-overflow:\s*ellipsis/)
  assert.doesNotMatch(visibleBadgeNameChildRule, /line-clamp/)
  assert.doesNotMatch(badgeCss, /\.user-display-badge-name \{[^}]*overflow:hidden/)
  assert.doesNotMatch(badgeCss, /\.user-display-badge-name \{[^}]*text-overflow:\s*ellipsis/)
})

test('long badge names remain literal and the profile information block can grow', () => {
  const component = read('components/UserDisplayName.tsx')
  const profileSummary = read('components/ProfileSummary.tsx')
  const css = read('app/globals.css')
  const badgeNames = [
    '时代曲',
    '疯狂的朋友',
    '疯狂的朋友超级限定纪念勋章',
    '疯狂的朋友超级限定纪念勋章特别版本',
  ]

  assert.equal(badgeNames.length, 4)
  assert.match(component, /badge-name-display[\s\S]*>\s*\{badge\.name\}\s*<\/span>/)
  assert.match(component, /displayBadge && showBadgeIcon/)
  assert.match(css, /\.user-display-name-stacked \{[^}]*height:auto/)
  assert.match(css, /\.user-display-name-nickname-row \{[^}]*white-space:normal/)
  assert.doesNotMatch(profileSummary, /<h1 className="truncate/)
  assert.match(profileSummary, /profile-hero-background relative isolate flex h-auto/)
  assert.match(css, /\.profile-hero-background \{\s*height:auto !important;\s*min-height:210px;/)
  assert.match(css, /\.friend-profile-card h2 \.user-display-name-text \{[^}]*overflow:visible[^}]*white-space:normal/)
})

test('badge rows are omitted when a user has no equipped badge', () => {
  const component = read('components/UserDisplayName.tsx')
  assert.match(component, /const displayBadge = showBadge \? liveBadge : null/)
  assert.match(component, /const stackedBadge = Boolean\(displayBadge && showBadgeName/)
  assert.match(component, /displayBadge && showBadgeIcon \?/)
  assert.match(component, /\{stackedBadge \? <span className="user-display-name-nickname-row">\{nickname\}<\/span> : nickname\}/)
})

test('profile and friend identity surfaces use the shared stacked badge behavior', () => {
  assert.match(read('components/ProfileSummary.tsx'), /<UserDisplayName name=\{displayName\}[^>]*showBadgeName/)
  assert.match(read('components/FriendProfileCard.tsx'), /<UserDisplayName name=\{name\}[^>]*showBadgeName/)
  assert.doesNotMatch(read('components/ProfileSummary.tsx'), /badgeTextEffectClass|badgeTextStyle/)
  assert.doesNotMatch(read('components/FriendProfileCard.tsx'), /text-overflow|line-clamp/)
})
