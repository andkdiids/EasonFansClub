import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { buildFollowBackfillPlan } from '../lib/follow-migration'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('legacy friendship backfill normalizes reversed pairs and is idempotent', () => {
  const plan = buildFollowBackfillPlan({
    friendships: [
      { userAId: 'user-a', userBId: 'user-b' },
      { userAId: 'user-b', userBId: 'user-a' },
      { userAId: 'user-a', userBId: 'user-a' },
      { userAId: 'user-a', userBId: 'deleted-user' },
    ],
    follows: [{ followerId: 'user-a', followingId: 'user-b' }],
    blocks: [{ blockerId: 'user-b', blockedId: 'user-a' }],
    users: [
      { id: 'user-a', status: 'ACTIVE', isDeleted: false, hasProfile: true },
      { id: 'user-b', status: 'ACTIVE', isDeleted: false, hasProfile: true },
    ],
  })

  assert.equal(plan.oldFriendCount, 4)
  assert.equal(plan.validPairs, 1)
  assert.equal(plan.expectedFollowRows, 2)
  assert.equal(plan.existingFollowRows, 1)
  assert.equal(plan.wouldInsertForward, 0)
  assert.equal(plan.wouldInsertReverse, 1)
  assert.equal(plan.blockedPairs, 1)
  assert.equal(plan.invalidPairs, 1)
  assert.equal(plan.selfRelations, 1)
  assert.equal(plan.reversedDuplicatePairs, 1)

  const complete = buildFollowBackfillPlan({
    friendships: [{ userAId: 'user-b', userBId: 'user-a' }],
    follows: [
      { followerId: 'user-a', followingId: 'user-b' },
      { followerId: 'user-b', followingId: 'user-a' },
    ],
    blocks: [],
    users: [
      { id: 'user-a', status: 'ACTIVE', isDeleted: false, hasProfile: true },
      { id: 'user-b', status: 'ACTIVE', isDeleted: false, hasProfile: true },
    ],
  })
  assert.equal(complete.backfillEdges.length, 0)
})

test('backfill and legacy accept use the same idempotent Follow insertion primitive', () => {
  const service = read('lib/follow-backfill-service.ts')
  const friends = read('lib/friends.ts')
  const applyScript = read('scripts/follow-migration.ts')
  assert.match(service, /createMany\([\s\S]*skipDuplicates: true/)
  assert.match(friends, /ensureMutualFollowInTransaction\(tx, friendRequest\.senderId, friendRequest\.receiverId\)/)
  assert.match(applyScript, /process\.argv\.includes\('--apply'\)/)
  assert.match(applyScript, /--confirm-apply/)
  assert.match(applyScript, /MODE: DRY RUN/)
})

test('legacy accept adds both Follow directions while reject and cancel remain non-mutating', () => {
  const friends = read('lib/friends.ts')
  const reject = read('app/api/friends/requests/[requestId]/reject/route.ts')
  const cancel = read('app/api/friends/requests/[requestId]/route.ts')
  assert.match(friends, /if \(action === 'accept'\)[\s\S]*ensureMutualFollowInTransaction/)
  assert.doesNotMatch(reject, /ensureMutualFollowInTransaction|follow\.(create|upsert|createMany)/)
  assert.match(cancel, /body\?\.action === 'cancel'/)
  assert.doesNotMatch(cancel.slice(0, cancel.indexOf("const action = body?.action === 'accept'")), /ensureMutualFollowInTransaction|follow\.(create|upsert|createMany)/)
  assert.match(friends, /friendRequest\.message/)
  assert.match(friends, /ensureFriendRequestConversation\(tx/)
})

test('all user-created DM paths use the unified Mutual Follow + Block authority', () => {
  const routes = [
    'app/api/direct-conversations/route.ts',
    'app/api/direct-conversations/[conversationId]/messages/route.ts',
    'app/api/posts/[postId]/share/route.ts',
    'app/api/material-redemptions/[materialId]/share/route.ts',
  ]
  for (const file of routes) {
    const route = read(file)
    assert.match(route, /requireRequestUser\(request\)/, file)
  }
  const messages = read('app/api/direct-conversations/[conversationId]/messages/route.ts')
  const postShare = read('app/api/posts/[postId]/share/route.ts')
  const materialShare = read('app/api/material-redemptions/[materialId]/share/route.ts')
  assert.match(messages, /assertCanDirectMessage\(user\.id, otherUserId/)
  assert.match(postShare, /assertCanDirectMessage\(input\.senderId, input\.recipientId, tx\)/)
  assert.match(materialShare, /assertCanDirectMessage\(input\.senderId, input\.recipientId, tx\)/)
  assert.match(messages, /type: 'STICKER'/)
  assert.match(messages, /type: 'TEXT'/)
  assert.match(postShare, /type: POST_SHARE_MESSAGE_TYPE/)
  assert.match(materialShare, /type: MATERIAL_SHARE_MESSAGE_TYPE/)
  assert.doesNotMatch(messages, /prisma\.friendship|normalizeFriendPair/)
  assert.doesNotMatch(postShare + materialShare, /prisma\.friendship|friendship\.find/)
})

test('conversation creation checks authorization before reusing pairKey and history stays participant-readable', () => {
  const conversations = read('app/api/direct-conversations/route.ts')
  const messages = read('app/api/direct-conversations/[conversationId]/messages/route.ts')
  assert.match(conversations, /assertCanDirectMessage\(user\.id, target\.id, tx\)/)
  assert.match(conversations, /ensureFriendConversation\(tx, user\.id, target\.id\)/)
  assert.match(messages, /ConversationParticipant: \{ some: \{ userId, isDeleted: false \} \}/)
  const getSource = messages.slice(messages.indexOf('export async function GET'), messages.indexOf('export async function POST'))
  assert.doesNotMatch(getSource, /assertCanDirectMessage/)
  assert.match(messages, /DirectMessageAuthorizationError/)
})

test('legacy delete-friend adapter removes only the viewer Follow and preserves chat data', () => {
  const route = read('app/api/friends/[userId]/route.ts')
  assert.match(route, /tx\.follow\.deleteMany\(\{ where: \{ followerId: viewer\.id, followingId: userId \} \}\)/)
  assert.doesNotMatch(route, /conversation\.delete|directMessage\.delete/)
  assert.match(route, /tx\.friendship\.deleteMany/)
})

test('DM routes are Bearer-enabled with method/path allowlisting and no mobile-only auth branch', () => {
  const middleware = read('middleware.ts')
  for (const pattern of [
    "pathname === '/api/direct-conversations'",
    'direct-conversations',
    'read|pin|clear',
    'recall',
    'posts',
    'material-redemptions',
  ]) assert.match(middleware, new RegExp(pattern))
  for (const file of [
    'app/api/direct-conversations/route.ts',
    'app/api/direct-conversations/[conversationId]/messages/route.ts',
    'app/api/direct-conversations/[conversationId]/read/route.ts',
    'app/api/direct-conversations/[conversationId]/pin/route.ts',
    'app/api/direct-conversations/[conversationId]/clear/route.ts',
    'app/api/direct-conversations/[conversationId]/messages/[messageId]/recall/route.ts',
  ]) assert.match(read(file), /requireRequestUser\(request\)/, file)
})
