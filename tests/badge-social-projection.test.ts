import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

test('shared equipped projection enforces Badge.visibility and UserBadge.isHidden server-side', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /visibility: true/)
  assert.match(service, /isHidden: true/)
  assert.match(service, /context: 'SOCIAL'/)
  assert.match(service, /decision\.canSeeOwnership && decision\.canSeeMetadata/)
  assert.doesNotMatch(service, /getUnrevealedAngelGiftBadgeIds/)
})

test('public profile modules do not return SECRET or user-hidden ownership metadata', () => {
  const route = read('app/api/users/[userId]/public-modules/route.ts')
  assert.match(route, /isHidden: false/)
  assert.match(route, /visibility: \{ not: 'SECRET'(?: as const)? \}/)
  assert.match(route, /resolveBadgeVisibility/)
  assert.match(route, /!decision\.canSeeOwnership \|\| !decision\.canSeeMetadata/)
})

test('activity prize projections mask restricted Badge metadata without changing draw behavior', () => {
  const source = read('lib/activity-lottery.ts')
  assert.match(source, /resolveBadgeVisibility/)
  assert.match(source, /activeUserBadgeWhere/)
  assert.match(source, /name: badgeHidden \? '神秘勋章' : prize\.name/)
  assert.match(source, /badge: badgeHidden \|\| !prize\.Badge \? null/)
})

test('Guess Song Duel public users filter SECRET and UserBadge.isHidden', () => {
  const source = read('lib/guess-song-duel-service.ts')
  assert.match(source, /visibility: \{ not: 'SECRET' \}/)
  assert.match(source, /isHidden: true/)
  assert.match(source, /context: 'GAME'/)
})

test('SECRET badge share cards are rejected while PUBLIC/HIDDEN owner sharing remains available', () => {
  const card = read('lib/badge-share-card.ts')
  const route = read('app/api/users/me/badges/[badgeId]/share-card/route.ts')
  assert.match(card, /SECRET_NOT_SHAREABLE/)
  assert.match(card, /context: 'SHARE'/)
  assert.match(route, /BadgeShareCardError/)
  assert.match(route, /status: 403/)
})

test('public social callers continue to use the shared batch projection', () => {
  const callers = [
    'app/api/posts/route.ts',
    'app/api/forum/feed/route.ts',
    'app/api/friends/list/route.ts',
    'app/api/direct-conversations/route.ts',
    'app/api/search/route.ts',
    'app/api/profile-wall/route.ts',
    'app/api/replies/[replyId]/like/route.ts',
    'app/api/daily-messages/route.ts',
    'lib/home-data.ts',
    'lib/notifications.ts',
    'lib/guess-song-leaderboard.ts',
  ]
  for (const file of callers) assert.match(read(file), /getEquippedBadgesForUsers/)
})
