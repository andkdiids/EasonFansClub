import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { relationshipViewFromSignals } from '../lib/relationship-resolver'

const read = (path: string) => readFileSync(path, 'utf8')

test('Resolver covers the canonical states and gives Block precedence over Mutual', () => {
  const none = { viewerFollowsTarget: false, targetFollowsViewer: false, blocked: false }
  const following = { viewerFollowsTarget: true, targetFollowsViewer: false, blocked: false }
  const followedBy = { viewerFollowsTarget: false, targetFollowsViewer: true, blocked: false }
  const mutual = { viewerFollowsTarget: true, targetFollowsViewer: true, blocked: false }
  const blocked = { viewerFollowsTarget: true, targetFollowsViewer: true, blocked: true }

  assert.equal(relationshipViewFromSignals(none).state, 'NONE')
  assert.equal(relationshipViewFromSignals(following).state, 'FOLLOWING')
  assert.equal(relationshipViewFromSignals(followedBy).state, 'FOLLOWED_BY')
  assert.equal(relationshipViewFromSignals(mutual).state, 'MUTUAL')
  assert.equal(relationshipViewFromSignals(mutual).canMessage, true)
  assert.equal(relationshipViewFromSignals(blocked).state, 'BLOCKED')
  assert.equal(relationshipViewFromSignals(blocked).canMessage, false)
  assert.equal(relationshipViewFromSignals(none, true).state, 'SELF')

  const resolver = read('lib/relationship-resolver.ts')
  assert.match(resolver, /db\.follow\.findMany/)
  assert.match(resolver, /db\.block\.findMany/)
  assert.doesNotMatch(resolver, /prisma\.friendship|Friendship/)
})

test('Follow mutation is Bearer-ready, directional, blocked, idempotent, and returns the resolver', () => {
  const route = read('app/api/users/[userId]/follow/route.ts')

  assert.match(route, /requireRequestUser\(request\)/g)
  assert.match(route, /findUnique\([\s\S]*followerId_followingId/)
  assert.match(route, /prisma\.follow\.create/)
  assert.match(route, /prisma\.follow\.deleteMany/)
  assert.match(route, /relationship: await resolveRelationship/)
  assert.match(route, /}, 403\)/)
  assert.match(route, /getFollowNotificationKey/)
  assert.match(route, /upsertNotification/)
  assert.doesNotMatch(route, /request\.json\(/)
  assert.doesNotMatch(route, /followerId.*request|request.*followerId/)
  assert.doesNotMatch(route, /friendship|conversation|directMessage/i)
})

test('Followers and Following use database pagination and batch relationship/badge reads', () => {
  for (const path of [
    'app/api/users/[userId]/followers/route.ts',
    'app/api/users/[userId]/following/route.ts',
  ]) {
    const route = read(path)
    assert.match(route, /requireRequestUser\(request\)/)
    assert.match(route, /skip,/)
    assert.match(route, /take: pageSize/)
    assert.match(route, /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/)
    assert.match(route, /resolveRelationships\(guard\.user\.id, userIds\)/)
    assert.match(route, /getFollowListBadges\(userIds, guard\.user\.id\)/)
    assert.doesNotMatch(route, /forEach\([\s\S]*resolveRelationship|for \(const .* of .*\)[\s\S]*resolveRelationship/)
  }
})

test('Relationship endpoint exposes only the canonical relationship view', () => {
  const route = read('app/api/users/[userId]/relationship/route.ts')
  assert.match(route, /requireRequestUser\(request\)/)
  assert.match(route, /resolveRelationship\(guard\.user\.id, target\.id\)/)
  assert.doesNotMatch(route, /reason|blockerId|blockedId/)
})

test('Follow schema adds the reverse lookup index without creating a second relation model', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260924090000_add_follow_follower_created_index/migration.sql')

  assert.match(schema, /model Follow\s*\{[\s\S]*?@@unique\(\[followerId, followingId\]\)[\s\S]*?@@index\(\[followerId, createdAt\]\)/)
  assert.match(schema, /model Follow\s*\{[\s\S]*?@@index\(\[followingId, createdAt\]\)/)
  assert.match(migration, /CREATE INDEX `Follow_followerId_createdAt_idx` ON `Follow`/)
  assert.doesNotMatch(migration, /DROP|DELETE|UPDATE|INSERT INTO|CREATE TABLE/i)
})

test('Bearer middleware opens both Follow mutation directions and read APIs symmetrically', () => {
  const middleware = read('middleware.ts')
  assert.ok(middleware.includes("|| /^\\/api\\/users\\/[^/]+\\/(?:relationship|followers|following)$/.test(pathname)"))
  assert.ok(middleware.includes("|| /^\\/api\\/users\\/[^/]+\\/follow$/.test(pathname)"))
  assert.ok(middleware.includes("|| /^\\/api\\/posts\\/[^/]+\\/like$/.test(pathname)"))
})

test('Follow notification has stable identity and no Friend Request fallback target', () => {
  const keys = read('lib/notification-keys.ts')
  const target = read('lib/notification-target.ts')
  assert.match(keys, /FOLLOW_NOTIFICATION_KEY_PREFIX/)
  assert.match(keys, /getFollowNotificationKey/)
  assert.match(target, /notification\.type === 'FRIEND_REQUEST'.*received-requests/)
  assert.match(target, /notification\.type === 'FOLLOW'.*profile/)
  assert.doesNotMatch(target, /FRIEND_REQUEST' \|\| notification\.type === 'FOLLOW'/)
})

test('Migration dry run is explicitly read-only and reports every cutover metric', () => {
  const script = read('scripts/follow-migration-dry-run.ts')
  for (const label of [
    'OLD FRIEND COUNT',
    'VALID FRIEND PAIRS',
    'EXPECTED FOLLOW ROWS',
    'EXISTING FOLLOW ROWS',
    'WOULD INSERT A→B',
    'WOULD INSERT B→A',
    'ALREADY EXISTING',
    'BLOCKED RELATIONSHIPS',
    'INVALID RELATIONSHIPS',
    'SELF RELATIONSHIPS',
    'DUPLICATE FRIEND PAIRS',
    'PENDING FRIEND REQUESTS',
  ]) assert.match(script, new RegExp(label))
  assert.doesNotMatch(script, /prisma\.(create|update|delete|upsert|createMany|updateMany|deleteMany|executeRaw)/)
})

test('Block route uses the same request auth and keeps the existing directional cleanup', () => {
  const route = read('app/api/users/[userId]/block/route.ts')
  assert.match(route, /requireRequestUser\(request\)/g)
  assert.match(route, /prisma\.follow\.deleteMany/)
  assert.match(route, /prisma\.friendFollow\.deleteMany/)
  assert.doesNotMatch(route, /conversation\.delete|directMessage\.delete/)
})
