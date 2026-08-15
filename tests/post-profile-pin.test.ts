import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20260816090000_add_post_profile_pin/migration.sql')
const profilePinRoute = read('app/api/posts/[postId]/profile-pin/route.ts')
const postDeleteRoute = read('app/api/posts/[postId]/route.ts')
const publicModulesRoute = read('app/api/users/[userId]/public-modules/route.ts')
const profileModules = read('components/PublicUserModules.tsx')
const postActions = read('components/PostActions.tsx')
const forumFeed = read('app/api/forum/feed/route.ts')
const forumDiscover = read('app/api/forum/discover/route.ts')

test('personal pin has its own nullable timestamp and profile-only index', () => {
  assert.match(schema, /profilePinnedAt\s+DateTime\?/)
  assert.match(schema, /@@index\(\[authorId, profilePinnedAt, createdAt\]\)/)
  assert.match(migration, /ADD COLUMN `profilePinnedAt` DATETIME\(3\) NULL/)
  assert.match(migration, /Post_authorId_profilePinnedAt_createdAt_idx/)
  assert.doesNotMatch(migration, /isPinned|isFeatured/)
})

test('profile pin API enforces author-only access and a transactional two-post limit', () => {
  assert.match(profilePinRoute, /requireUser\(\)/)
  assert.match(profilePinRoute, /post\.authorId !== userId/)
  assert.match(profilePinRoute, /FOR UPDATE/)
  assert.match(profilePinRoute, /profilePinnedAt: \{ not: null \}/)
  assert.match(profilePinRoute, /pinnedCount >= 2/)
  assert.match(profilePinRoute, /PROFILE_PIN_LIMIT/)
  assert.match(profilePinRoute, /status: 409/)
  assert.doesNotMatch(profilePinRoute, /hasAdminPermission|isFeatured:/)
})

test('profile post pagination sorts personal pins first without changing regular ordering', () => {
  assert.match(publicModulesRoute, /orderBy: \[\{ profilePinnedAt: 'desc' \}, \{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/)
  assert.match(publicModulesRoute, /skip: \(pagination\.page - 1\) \* pagination\.pageSize/)
  assert.match(publicModulesRoute, /take: pagination\.pageSize/)
  assert.match(publicModulesRoute, /moderationStatus: \{ in: \['APPROVED', 'VIOLATION'\]/)
  assert.match(publicModulesRoute, /isProfilePinned: Boolean\(profilePinnedAt\)/)
})

test('profile pins survive moderation filtering for the author but stay hidden from visitors while pending', () => {
  const pendingBranch = publicModulesRoute.slice(publicModulesRoute.indexOf('const canViewPendingPosts'))
  assert.match(pendingBranch, /viewer\.id === target\.id/)
  assert.match(pendingBranch, /status: 'PUBLISHED'/)
  assert.match(pendingBranch, /moderationStatus: \{ in: \['APPROVED', 'VIOLATION'\]/)
  assert.match(profileModules, /post\.isProfilePinned/)
})

test('only the profile owner receives the personal pin menu and successful changes reload the ordered pages', () => {
  assert.match(profileModules, /isSelf \? \(/)
  assert.match(profileModules, /<PersonalPostPinMenu/)
  assert.match(profileModules, /loadModule\('posts', 1\)/)
  assert.match(postActions, /PersonalPostPinMenu/)
  assert.match(postActions, /\/api\/posts\/\$\{postId\}\/profile-pin/)
  assert.match(postActions, /method: nextIsPinned \? 'POST' : 'DELETE'/)
})

test('personal pin is cleared with soft deletion and never participates in public forum ordering', () => {
  assert.match(postDeleteRoute, /profilePinnedAt: null/)
  assert.doesNotMatch(forumFeed, /profilePinnedAt/)
  assert.doesNotMatch(forumDiscover, /profilePinnedAt/)
})
