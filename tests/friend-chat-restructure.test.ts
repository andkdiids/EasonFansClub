import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compareFriendConversationOrder } from '../lib/friend-conversation-order'

const read = (path: string) => readFileSync(path, 'utf8')
const dock = read('components/FriendDock.tsx')
const conversations = read('app/api/direct-conversations/route.ts')
const messages = read('app/api/direct-conversations/[conversationId]/messages/route.ts')
const clear = read('app/api/direct-conversations/[conversationId]/clear/route.ts')
const schema = read('prisma/schema.prisma')

test('好友弹窗一级导航默认聊天，通讯录内保留 A-Z 与分组', () => {
  assert.match(dock, /type FriendDockTab = 'chat' \| 'contacts'/)
  assert.match(dock, /useState<FriendDockTab>\('chat'\)/)
  assert.match(dock, /setActiveTab\('chat'\)/)
  assert.match(dock, /<button[\s\S]*?role="tab"[\s\S]*?>聊天<\/button>[\s\S]*?<button[\s\S]*?role="tab"[\s\S]*?>通讯录<\/button>/)
  assert.match(dock, /activeTab === 'chat' \? \(/)
  assert.match(dock, /activeTab === 'contacts'/)
  assert.match(dock, /friendListViewMode === 'alphabetical'/)
  assert.match(dock, /friendListViewMode === 'groups'/)
  assert.match(dock, /FriendAlphabetIndex/)
})

test('聊天接口只返回有可见私信的会话，不把空会话当聊天', () => {
  assert.match(conversations, /DirectMessage: \{[\s\S]*take: 1/)
  assert.match(conversations, /if \(!participant \|\| !other \|\| !latest\) return null/)
  assert.match(conversations, /if \(participant\.clearedAt && latest\.createdAt <= participant\.clearedAt\) return null/)
  assert.match(conversations, /\.filter\(\(row\): row is NonNullable<typeof row> => row !== null\)/)
  assert.match(conversations, /\.sort\(\(left, right\) => compareFriendConversationOrder/)
  assert.match(conversations, /\.slice\(0, 30\)/)
})

test('聊天项使用最后消息、真实时间倒序、备注和未读数，并避免逐聊天 N+1', () => {
  const rows = [
    { latestMessageAt: new Date('2026-08-28T03:00:00.000Z'), fallbackAt: new Date('2026-01-01T00:00:00.000Z'), stableId: 'a' },
    { latestMessageAt: new Date('2026-08-28T03:10:00.000Z'), fallbackAt: new Date('2026-01-01T00:00:00.000Z'), stableId: 'b' },
  ]
  assert.deepEqual(rows.sort(compareFriendConversationOrder).map((row) => row.stableId), ['b', 'a'])
  assert.match(conversations, /loadFriendRemarkMap\(user\.id, otherUserIds\)/)
  assert.match(conversations, /getEquippedBadgesForUsers\(otherUserIds\)/)
  assert.match(conversations, /unreadCount: unreadByConversation\.get\(row\.id\) \|\| 0/)
  assert.match(dock, /latestMessage\?\.preview/)
  assert.match(dock, /onOpen=\{\(\) => void openChat\(conversation\.otherUser, conversation\.id\)\}/)
})

test('聊天删除是当前参与者 clearedAt，不物理删除消息，新消息可以恢复', () => {
  assert.match(dock, /600\)/)
  assert.match(dock, /longPressTriggeredRef/)
  assert.match(dock, /title="删除聊天"/)
  assert.match(dock, /<ConfirmDialog[\s\S]*title="删除聊天？"/)
  assert.match(dock, /fetch\(`\/api\/direct-conversations\/\$\{target\.id\}\/clear`[\s\S]*method: 'POST'/)
  assert.match(dock, /setConversations\(\(current\) => current\.filter\(\(conversation\) => conversation\.id !== target\.id\)\)/)
  assert.match(clear, /clearedAt, lastReadAt: clearedAt/)
  assert.doesNotMatch(clear, /directMessage\.(delete|deleteMany)/)
  assert.match(messages, /createdAt: \{ gt: viewerParticipant\.clearedAt \}/)
  assert.match(schema, /model ConversationParticipant[\s\S]*clearedAt\s+DateTime\?/) 
})

test('聊天错误显示重试而非误报暂无聊天，通讯录与聊天数据状态分离', () => {
  assert.match(dock, /chatListError/)
  assert.match(dock, /聊天列表加载失败/)
  assert.match(dock, /onClick=\{\(\) => void loadConversations\(\)\}/)
  assert.match(dock, /conversationsLoaded && !conversations\.length/)
  assert.match(dock, /activeTab !== 'contacts'/)
  assert.match(dock, /activeTab !== 'chat'/)
})
