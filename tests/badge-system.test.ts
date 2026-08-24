import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('badge schema exposes PUBLIC, HIDDEN and SECRET visibility', () => {
  const schema = read('prisma/schema.prisma')
  for (const value of ['PUBLIC', 'HIDDEN', 'SECRET']) {
    assert.match(schema, new RegExp(`enum BadgeVisibility[\\s\\S]*${value}`))
  }
})

test('badge schema exposes rarity and grant enums', () => {
  const schema = read('prisma/schema.prisma')
  for (const value of ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'LIMITED']) {
    assert.match(schema, new RegExp(`enum BadgeRarity[\\s\\S]*${value}`))
  }
  for (const value of ['AUTO', 'MANUAL', 'EVENT']) {
    assert.match(schema, new RegExp(`enum BadgeGrantType[\\s\\S]*${value}`))
  }
})

test('badge schema exposes controlled visual and nickname effects', () => {
  const schema = read('prisma/schema.prisma')
  for (const value of ['NONE', 'SHINE', 'GLOW', 'SPARKLE']) {
    assert.match(schema, new RegExp(`enum BadgeEffectType[\\s\\S]*${value}`))
  }
  for (const value of ['NONE', 'COLOR', 'GOLD', 'GRADIENT', 'GLOW']) {
    assert.match(schema, new RegExp(`enum BadgeNicknameEffect[\\s\\S]*${value}`))
  }
})

test('badge schema keeps a unique code and one equipped badge relation', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /code\s+String\s+@unique/)
  assert.match(schema, /equippedBadgeId\s+String\?/)
  assert.match(schema, /@relation\("UserEquippedBadge"/)
})

test('user badge records remain idempotent per user and badge', () => {
  assert.match(read('prisma/schema.prisma'), /@@unique\(\[userId, badgeId\]\)/)
})

test('badge migration backfills legacy slugs into codes', () => {
  const migration = read('prisma/migrations/20260821153000_add_honor_badge_system/migration.sql')
  assert.match(migration, /UPDATE `Badge`\s+SET `code` = `slug`/)
})

test('badge migration protects equipped references with SET NULL', () => {
  const migration = read('prisma/migrations/20260821153000_add_honor_badge_system/migration.sql')
  assert.match(migration, /ADD CONSTRAINT `User_equippedBadgeId_fkey`/)
  assert.match(migration, /ON DELETE SET NULL/)
})

test('badge migration stores obtained and grant audit metadata', () => {
  const migration = read('prisma/migrations/20260821153000_add_honor_badge_system/migration.sql')
  assert.match(migration, /UserBadge[\s\S]*obtainedAt|obtainedAt[\s\S]*UserBadge/)
  assert.match(migration, /UserBadge[\s\S]*grantedBy|grantedBy[\s\S]*UserBadge/)
})

test('badge service has a central idempotent grant operation', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /export async function grantBadge/)
  assert.match(service, /userId_badgeId/)
})

test('badge service has a central revoke operation', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /export async function revokeBadge/)
  assert.match(service, /BADGE_REVOKE/)
})

test('badge grant and revoke write through transactions and action logs', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /prisma\.\$transaction/)
  assert.match(service, /FOR UPDATE/)
  assert.match(service, /BADGE_GRANT/)
  assert.match(service, /BADGE_REVOKE/)
})

test('badge service supports has, equip and unequip operations', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /export async function hasBadge/)
  assert.match(service, /export async function equipBadge/)
  assert.match(service, /export async function unequipBadge/)
  assert.match(service, /BADGE_NOT_WEARABLE/)
})

test('public badge collection never returns an unowned SECRET catalog badge', () => {
  assert.match(read('lib/badge-service.ts'), /if \(badge\.visibility === 'SECRET'\) return \[\]/)
})

test('public badge collection uses a redacted HIDDEN placeholder', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /function hiddenBadgeView/)
  assert.ok(service.includes("name: '???'"))
  assert.match(service, /imageUrl: null/)
})

test('non-owners cannot read hidden UserBadge records', () => {
  assert.match(read('lib/badge-service.ts'), /where: \{ userId, \.\.\.\(isSelf \? \{\} : \{ isHidden: false \}\) \}/)
})

test('equip API requires an authenticated user and rate limits writes', () => {
  const route = read('app/api/users/me/badge/equip/route.ts')
  assert.match(route, /requireUser\(\)/)
  assert.match(route, /enforceApiRateLimit/)
})

test('equip API calls central equip and unequip services', () => {
  const route = read('app/api/users/me/badge/equip/route.ts')
  assert.match(route, /equipBadge\(guard\.user\.id, badgeId\)/)
  assert.match(route, /unequipBadge\(guard\.user\.id\)/)
})

test('equip API invalidates current-user and badge profile views', () => {
  const route = read('app/api/users/me/badge/equip/route.ts')
  assert.match(route, /invalidateCurrentUserCache\(userId\)/)
  assert.match(route, /\/badges/)
})

test('admin badge list and item routes require achievement_manage', () => {
  assert.match(read('app/api/admin/badges/route.ts'), /requireAdmin\('achievement_manage'\)/)
  assert.match(read('app/api/admin/badges/[badgeId]/route.ts'), /requireAdmin\('achievement_manage'\)/)
})

test('admin deletion blocks badges that still have owners', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /HAS_OWNERS/)
  assert.match(service, /deleteBadgeSafely/)
})

test('admin badge deletion only cleans known badge COS objects', () => {
  assert.match(read('app/api/admin/badges/[badgeId]/route.ts'), /cleanupBadgeImage/)
})

test('badge uploader accepts only PNG/WebP MIME and matching extensions', () => {
  const route = read('app/api/admin/badges/upload/route.ts')
  assert.match(route, /\['image\/png', 'image\/webp'\]/)
  assert.match(route, /扩展名与 MIME 类型不一致/)
})

test('badge uploader enforces a 2 MiB size limit and image signatures', () => {
  const route = read('app/api/admin/badges/upload/route.ts')
  assert.match(route, /MAX_BADGE_IMAGE_BYTES = 2 \* 1024 \* 1024/)
  assert.match(route, /hasPngSignature\(buffer\)/)
  assert.match(route, /hasWebpSignature\(buffer\)/)
})

test('badge uploader validates metadata and preserves the original alpha-capable buffer', () => {
  const route = read('app/api/admin/badges/upload/route.ts')
  assert.match(route, /sharp\(buffer/)
  assert.match(route, /limitInputPixels: 2048 \* 2048/)
  assert.match(route, /body: buffer, contentType/)
})

test('badge uploader stores images under the scoped badge COS prefix', () => {
  assert.match(read('app/api/admin/badges/upload/route.ts'), /badges\/\$\{guard\.user\.id\}\/\$\{randomUUID\(\)\}\.\$\{outputExtension\}/)
})

test('nickname shine separates enabled state and shine color from the inherited base color', () => {
  const component = read('components/UserDisplayName.tsx')
  const types = read('lib/badge-types.ts')
  assert.match(component, /isBadgeNicknameShineEnabled/)
  assert.match(component, /getBadgeNicknameShineColor/)
  assert.match(component, /--badge-shine-color/)
  assert.match(component, /user-display-name-base/)
  assert.match(component, /user-display-name-highlight/)
  assert.match(types, /nicknameColor is the shine color/)
  assert.match(component, /normalizeBadgeColor/)
  assert.doesNotMatch(component, /color:\s*normalizeBadgeColor\(badge\.nicknameColor\)/)
})

test('nickname CSS never makes the base text transparent or owns the page text color', () => {
  const css = read('app/globals.css')
  const nicknameCss = css.slice(css.indexOf('/* E院勋章'), css.indexOf('.user-display-badge {'))
  assert.match(nicknameCss, /\.user-display-name-base \{ color:inherit; \}/)
  assert.match(nicknameCss, /\.user-display-name-highlight \{[^}]*color:var\(--badge-shine-color/)
  assert.match(nicknameCss, /mask-image:linear-gradient/)
  assert.doesNotMatch(nicknameCss, /background-clip:text|-webkit-text-fill-color|color:transparent/)
})

test('badge hover, focus and click details are available in the unified name component', () => {
  const component = read('components/UserDisplayName.tsx')
  assert.match(component, /BadgeDetail/)
  assert.match(component, /user-display-badge-tooltip/)
  assert.match(component, /onKeyDown/)
})

test('badge visual effects include shine, glow and sparkle animation classes', () => {
  const css = read('app/globals.css')
  assert.match(css, /badge-effect-shine/)
  assert.match(css, /badge-effect-glow/)
  assert.match(css, /badge-effect-sparkle/)
})

test('badge animations respect prefers-reduced-motion', () => {
  assert.match(read('app/globals.css'), /prefers-reduced-motion: reduce/)
})

test('equipped badge lookups use a bounded batch loader', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /getEquippedBadgesForUsers/)
  assert.match(service, /two bounded queries/)
})

test('post, forum, check-in, friend, search and leaderboard surfaces use batch badge data', () => {
  for (const path of [
    'app/api/posts/route.ts',
    'app/api/forum/feed/route.ts',
    'lib/checkin-messages.ts',
    'app/api/friends/list/route.ts',
    'app/api/friends/activity/route.ts',
    'app/api/search/route.ts',
    'lib/guess-song-leaderboard.ts',
    'lib/want-listen-leaderboard.ts',
  ]) assert.match(read(path), /getEquippedBadgesForUsers/)
})

test('major nickname surfaces render through the shared UserDisplayName component', () => {
  for (const path of [
    'components/FriendDock.tsx',
    'components/FriendActivityPanel.tsx',
    'components/ProfileWall.tsx',
    'components/PostRepliesSection.tsx',
    'components/PostList.tsx',
    'components/ForumDiscoveryCard.tsx',
    'components/CheckInMessagesPanel.tsx',
    'app/search/page.tsx',
    'app/notifications/NotificationsClient.tsx',
  ]) assert.match(read(path), /UserDisplayName/)
  assert.match(read('components/UserDisplayName.tsx'), /user-display-name-highlight/)
})

test('homepage entertainment scores include equipped badges and link to profiles', () => {
  assert.match(read('lib/guess-song-leaderboard.ts'), /equippedBadgeMap = await getEquippedBadgesForUsers\(availableRows/)
  assert.match(read('components/HomeLayoutSurface.tsx'), /score\.user\.equippedBadge/)
  assert.match(read('components/HomeLayoutSurface.tsx'), /formatUid\(score\.user\.uid\)/)
})

test('badge admin mutations are transactional, logged and invalidate every equipped owner', () => {
  const service = read('lib/badge-service.ts')
  const route = read('app/api/admin/badges/[badgeId]/route.ts')
  const createRoute = read('app/api/admin/badges/route.ts')
  assert.match(service, /writeBadgeAdminAction/)
  for (const action of ['BADGE_CREATE', 'BADGE_UPDATE', 'BADGE_ENABLE', 'BADGE_DISABLE']) assert.match(route + createRoute, new RegExp(action))
  for (const action of ['BADGE_DELETE', 'BADGE_GRANT', 'BADGE_REVOKE']) assert.match(service, new RegExp(action))
  assert.match(route, /affectedUsers = await tx\.user\.findMany/)
  assert.match(route, /data\.isWearable === false/)
})

test('mobile duel rooms hide verbose badge names while retaining the badge icon', () => {
  assert.match(read('app/globals.css'), /\.duel-room-player \.user-display-badge-name \{ display:none; \}/)
})

test('birthday automation reuses the central badge grant service', () => {
  assert.match(read('lib/birthday.ts'), /grantBadge\(/)
})

test('concert automation and seed data use the new badge identity fields', () => {
  assert.match(read('lib/concert-badge.ts'), /grantBadge\(/)
  assert.match(read('prisma/seed.ts'), /code:\s*'birthday-commemorative'/)
})

test('badge wall has preview and full collection modes', () => {
  const panel = read('components/BadgeCollectionPanel.tsx')
  assert.match(panel, /preview/)
  assert.match(panel, /OBTAINED|NOT_OBTAINED/)
})

test('badge wall exposes self-only equip controls and immediate sync events', () => {
  const panel = read('components/BadgeCollectionPanel.tsx')
  assert.match(panel, /equip/)
  assert.match(panel, /eason-badge-updated/)
  assert.match(read('app/user/[uid]/badges/page.tsx'), /BadgeCollectionPanel/)
})

test('admin badge management supports grant, revoke and owner inspection routes', () => {
  assert.match(read('app/api/admin/badges/[badgeId]/grant/route.ts'), /grantBadge/)
  assert.match(read('app/api/admin/badges/[badgeId]/revoke/route.ts'), /revokeBadge/)
  assert.match(read('app/api/admin/badges/[badgeId]/owners/route.ts'), /requireAdmin\('achievement_manage'\)/)
})
