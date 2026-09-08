import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compareFriendConversationOrder } from '../lib/friend-conversation-order'
import { defaultBoards } from '../lib/boards'

const read = (path: string) => readFileSync(path, 'utf8')
const friendService = read('lib/friends.ts')
const conversations = read('app/api/direct-conversations/route.ts')
const pinRoute = read('app/api/direct-conversations/[conversationId]/pin/route.ts')
const friendDock = read('components/FriendDock.tsx')
const schema = read('prisma/schema.prisma')
const pinMigration = read('prisma/migrations/20260908140000_add_conversation_participant_pinned_at/migration.sql')

test('接受好友申请会在同一事务复用会话并把申请理由写入正常私信', () => {
  assert.match(friendService, /async function ensureFriendRequestConversation\(/)
  assert.match(friendService, /tx\.conversation\.upsert\([\s\S]*where: \{ pairKey \}/)
  assert.match(friendService, /tx\.conversationParticipant\.upsert\([\s\S]*isDeleted: false/)
  assert.match(friendService, /tx\.directMessage\.upsert\([\s\S]*senderId_clientMessageId/)
  assert.match(friendService, /clientMessageId = friendRequestGreetingClientMessageId\(input\.requestId\)/)
  assert.match(friendService, /senderId: input\.senderId/)
  assert.match(friendService, /reason: friendRequest\.message/)
  assert.match(friendService, /if \(!content\) return \{ conversationId: conversation\.id, greetingMessageId: null/)
  assert.match(friendService, /ensureFriendRequestConversation\(tx, \{[\s\S]*requestId,[\s\S]*senderId: friendRequest\.senderId,[\s\S]*receiverId: friendRequest\.receiverId/)
})

test('私信列表按当前用户的置顶状态优先，再按最新消息排序', () => {
  const pinnedOlder = {
    latestMessageAt: new Date('2026-09-08T09:00:00.000Z'),
    fallbackAt: new Date('2026-09-08T08:00:00.000Z'),
    stableId: 'pinned',
    isPinned: true,
  }
  const unpinnedNewer = {
    latestMessageAt: new Date('2026-09-08T10:00:00.000Z'),
    fallbackAt: new Date('2026-09-08T08:00:00.000Z'),
    stableId: 'newer',
    isPinned: false,
  }
  assert.deepEqual([unpinnedNewer, pinnedOlder].sort(compareFriendConversationOrder), [pinnedOlder, unpinnedNewer])
  assert.match(conversations, /pinnedAt: row\.ConversationParticipant\.find\([\s\S]*user\.id\)\?\.pinnedAt/)
  assert.match(conversations, /isPinned: Boolean\(left\.ConversationParticipant\.find\([\s\S]*pinnedAt\)/)
  assert.match(pinRoute, /const user = await getCurrentUser\(\)/)
  assert.match(pinRoute, /conversationId_userId: \{ conversationId, userId: user\.id \}/)
  assert.match(pinRoute, /normalizeFriendPair\(user\.id, peerIds\[0\]\)/)
  assert.match(pinRoute, /data: \{ pinnedAt \}/)
  assert.match(pinRoute, /emitRealtime\(user\.id, 'message'/)
  assert.match(schema, /pinnedAt\s+DateTime\?/)
  assert.match(pinMigration, /ALTER TABLE `ConversationParticipant`[\s\S]*ADD COLUMN `pinnedAt` DATETIME\(3\) NULL/)
})

test('好友聊天列表和通讯录好友行都限制为一枚勋章，资料卡默认不受影响', () => {
  assert.equal((friendDock.match(/maxDisplay=\{1\}/g) || []).length, 2)
  assert.match(friendDock, /置顶聊天/)
  assert.match(friendDock, /取消置顶/)
  assert.match(friendDock, /onTogglePin/)
  assert.match(friendDock, /data-pinned=/)
})

test('物料分区只更换显示名并保留稳定 slug', () => {
  const materialBoard = defaultBoards.find((board) => board.slug === 'merch-exchange')
  assert.ok(materialBoard)
  assert.equal(materialBoard.name, '物料')
  assert.equal(materialBoard.slug, 'merch-exchange')
  assert.doesNotMatch(read('lib/boards.ts'), /name: '物料交换'/)
})
