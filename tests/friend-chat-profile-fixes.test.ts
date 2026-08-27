import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveGrowthLevelName } from '../lib/growth-display'

const read = (path: string) => readFileSync(path, 'utf8')
const profile = read('app/profile/page.tsx')
const publicProfile = read('app/user/[uid]/page.tsx')
const profileSurface = read('components/ProfilePageSurface.tsx')
const profileSummary = read('components/ProfileSummary.tsx')
const sidebarSummary = read('components/UserProfileSummary.tsx')
const friendDock = read('components/FriendDock.tsx')
const friendCard = read('components/FriendProfileCard.tsx')
const friendRequestActions = read('components/FriendRequestActions.tsx')
const friendList = read('app/api/friends/list/route.ts')
const conversations = read('app/api/direct-conversations/route.ts')
const messages = read('app/api/direct-conversations/[conversationId]/messages/route.ts')
const readRoute = read('app/api/direct-conversations/[conversationId]/read/route.ts')
const notifications = read('lib/notifications.ts')
const notificationClient = read('app/notifications/NotificationsClient.tsx')
const appShell = read('components/layout/AppShell.tsx')
const notificationProvider = read('components/NotificationProvider.tsx')
const css = read('app/globals.css')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20260730100000_add_direct_message_idempotency/migration.sql')

test('统一成长等级优先配置且缺失时安全回退', () => {
  assert.equal(resolveGrowthLevelName(1), '初入E院')
  assert.equal(resolveGrowthLevelName(3), '稳定治疗')
  assert.equal(resolveGrowthLevelName(2, '自定义观察期'), '自定义观察期')
  assert.equal(resolveGrowthLevelName(undefined, ''), '初入E院')
})

test('本人和他人主页都传入真实等级称号且不显示 Lv', () => {
  assert.match(profile, /getGrowthSummarySafe\(profile\.experience\)/)
  assert.match(profile, /growth=\{growth\}/)
  assert.match(publicProfile, /getGrowthSummarySafe\(user\.experience\)/)
  assert.match(publicProfile, /growth=\{growth\}/)
  assert.match(profileSurface, /levelName=\{growth\.levelName\}/)
  assert.match(profileSummary, /resolveGrowthLevelName\(level, levelName\)/)
  assert.doesNotMatch(profileSummary + sidebarSummary, /Lv\./)
})

test('个人主页身份信息不再使用会形成方框的胶囊背景且支持换行', () => {
  assert.equal((profileSummary.match(/className="[^"]*profile-identity-badge(?:\s|")/g) || []).length, 2)
  assert.match(css, /\.profile-identity-badge \{[^}]*min-height:0;[^}]*border:0;[^}]*border-radius:0;[^}]*padding:0;[^}]*color:inherit;[^}]*background:transparent;[^}]*box-shadow:none/)
  assert.match(profileSummary, /profile-identity-badges[\s\S]*flex-wrap/)
})

test('他人主页不查询或渲染帖子回复好友统计', () => {
  assert.doesNotMatch(publicProfile, /ProfileStatsGrid|friendCount|_count\.Post|_count\.Reply|Friendship_Friendship/)
  assert.match(publicProfile, /viewer\?\.id === user\.id/)
  assert.match(profileSurface, /PublicUserModules/)
})

test('好友头像打开安全资料卡且资料卡提供主页和私信', () => {
  assert.match(friendDock, /onProfile=\{\(\) => setProfileFriend\(friend\)\}/)
  assert.match(friendDock, /<FriendProfileCard/)
  assert.match(friendCard, /查看主页/)
  assert.match(friendCard, /发私信/)
  assert.match(friendCard, /event\.target === event\.currentTarget/)
  assert.doesNotMatch(friendCard + friendList, /passwordHash|email: true|phone: true|securityQuestion/)
})

test('好友列表独立滚动、分页加载且保留末尾 padding', () => {
  assert.match(css, /\.friend-dock-list \{[^}]*min-height:0;[^}]*flex:1;[^}]*overflow-y:auto;[^}]*overscroll-behavior:contain/)
  assert.match(friendDock, /friendListViewMode === 'groups'/)
  assert.match(friendDock, /加载分组成员|加载更多\$\{group\.name\}好友/)
  assert.match(friendDock, /friend-dock-list-end/)
  assert.match(friendList, /const pageStart = \(page - 1\) \* pageSize/)
  assert.match(friendList, /const visibleRows = orderedFriendRows\.slice\(pageStart, pageStart \+ pageSize\)/)
  assert.match(friendList, /pageSize = Math\.min\(50/)
})

test('同一搜索栏返回统一好友关系状态且不返回登录账号', () => {
  const relationshipActions = friendDock + friendRequestActions
  for (const status of ['FRIEND', 'OUTGOING_PENDING', 'INCOMING_PENDING', 'NONE', 'SELF', 'BLOCKED']) {
    assert.match(friendList, new RegExp(`'${status}'`))
  }
  assert.match(friendDock, /搜索好友或其他用户/)
  assert.match(relationshipActions, /还不是好友/)
  assert.match(relationshipActions, /添加好友/)
  assert.match(relationshipActions, /对方申请添加你/)
  assert.doesNotMatch(friendList, /username: true|email: true|phone: true|passwordHash/)
})

test('遮罩由 body portal 固定覆盖且 viewport 监听会清理', () => {
  assert.match(friendDock, /createPortal\(/)
  assert.match(css, /\.friend-dock-backdrop \{[^}]*position:fixed;[^}]*inset:0;[^}]*width:100vw;[^}]*height:100dvh/)
  assert.match(friendDock, /visualViewport\?\.addEventListener\('resize'/)
  assert.match(friendDock, /visualViewport\?\.removeEventListener\('resize'/)
  assert.match(css, /--friend-dock-viewport-height/)
})

test('聊天为单一连续界面并支持历史分页、日期和北京时间', () => {
  assert.match(friendDock, /friend-chat-layout/)
  assert.match(friendDock, /加载更早消息/)
  assert.match(messages, /beforeCursor/)
  assert.match(friendDock, /今天/)
  assert.match(friendDock, /昨天/)
  assert.match(friendDock, /timeZone: 'Asia\/Shanghai'/)
})

test('气泡按内容自适应且长内容可换行', () => {
  assert.match(css, /\.friend-chat-bubble \{[^}]*width:fit-content;[^}]*max-width:min\(78%,30rem\)/)
  assert.match(css, /\.friend-chat-bubble \{[^}]*overflow-wrap:anywhere;[^}]*white-space:pre-wrap/)
  assert.doesNotMatch(css, /\.friend-chat-bubble \{[^}]*width:100%/)
})

test('单勾仅表示服务端保存未读，双勾表示对方已读', () => {
  assert.match(friendDock, /服务端已保存，对方未读/)
  assert.match(friendDock, /对方已读[\s\S]*✓✓/)
  assert.match(messages, /peerLastReadAt/)
  assert.match(messages, /message\.createdAt <= peerLastReadAt/)
})

test('聊天使用实时事件、稳定游标和去重', () => {
  assert.match(friendDock, /realtime:event/)
  assert.match(friendDock, /syncOpenConversation/)
  assert.doesNotMatch(friendDock, /window\.setTimeout\(poll, 3000\)/)
  assert.match(friendDock, /document\.visibilityState === 'hidden'/)
  assert.match(friendDock, /\?after=/)
  assert.match(messages, /createdAt: \{ gt: cursor\.createdAt \}/)
  assert.match(messages, /createdAt: cursor\.createdAt, id: \{ gt: cursor\.id \}/)
  assert.match(friendDock, /const byId = new Map/)
})

test('发送接口忽略 senderId、验证好友接收者并限制内容', () => {
  assert.match(messages, /const user = await getCurrentUser\(\)/)
  assert.match(messages, /senderId: user\.id/)
  assert.match(messages, /只能给好友发送私信/)
  assert.match(messages, /接收用户不存在或不可用/)
  assert.match(messages, /消息不能为空/)
  assert.match(messages, /消息不能超过1000个字符/)
  assert.doesNotMatch(messages, /body\?\.senderId/)
})

test('clientMessageId 和数据库唯一约束保证重试幂等', () => {
  assert.match(friendDock, /crypto\.randomUUID\(\)/)
  assert.match(messages, /senderId_clientMessageId/)
  assert.match(messages, /error\.code === 'P2002'/)
  assert.match(schema, /clientMessageId\s+String\?/)
  assert.match(schema, /@@unique\(\[senderId, clientMessageId\]\)/)
  assert.match(migration, /ADD COLUMN `clientMessageId`/)
  assert.match(migration, /CREATE UNIQUE INDEX/)
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE)\b/i)
})

test('已读接口仅以 session 参与者更新 lastReadAt', () => {
  assert.match(readRoute, /getCurrentUser\(\)/)
  assert.match(readRoute, /conversationId_userId: \{ conversationId, userId: user\.id \}/)
  assert.match(readRoute, /messageId/)
  assert.match(readRoute, /visibleMessage\.createdAt/)
  assert.match(readRoute, /lastReadAt: readAt/)
  assert.doesNotMatch(readRoute, /receiverId/)
})

test('统一未读按真实消息条数统计并在好友行展示', () => {
  assert.match(notifications, /SELECT COUNT\(\*\) AS unreadCount[\s\S]*FROM DirectMessage/)
  assert.match(notifications, /messages: directMessages/)
  assert.match(friendList, /unreadCount/)
  assert.match(friendDock, /friend-dock-row-unread/)
  assert.match(friendList, /compareFriendConversationOrder/)
  assert.match(friendList, /latestMessageAt: .*DirectMessage\[0\]\?\.createdAt/)
  assert.doesNotMatch(friendList, /Number\(b\.unreadCount > 0\) - Number\(a\.unreadCount > 0\)/)
})

test('通知中心显示私信来源且总红点由统一汇总同步', () => {
  assert.match(notificationClient, /messages: '私信'/)
  assert.match(notificationClient, /未读私信 \{unreadSummary\.messages\} 条/)
  assert.match(notificationClient, /friend-dock:open/)
  assert.doesNotMatch(appShell, /\/api\/notifications\/unread-summary/)
  assert.match(notificationProvider, /eason-private-sync:\$\{userId\}/)
  assert.match(notificationProvider, /new RealtimeClient/)
  assert.doesNotMatch(notificationProvider, /POLL_INTERVAL_MS/)
})

test('E院中心使用28px突出高度加10px间距避让中间按钮', () => {
  assert.match(css, /--mobile-center-action-overhang: 28px/)
  assert.match(css, /var\(--mobile-center-action-overhang\) \+ 10px/)
  assert.match(css, /\.mobile-center-sheet \{[^}]*overflow-y:auto/)
})

test('所有好友私信接口明确禁止公共缓存', () => {
  for (const source of [friendList, conversations, messages, readRoute]) {
    assert.match(source, /private, no-store/)
  }
})
