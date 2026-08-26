import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { getFriendDisplayName, normalizeFriendRemark } from '../lib/friend-display-name'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

test('备注 helper 在私人好友语境优先使用备注', () => {
  assert.equal(getFriendDisplayName({ nickname: '天才可鲁贝洛斯', friendRemark: '小可', isFriendContext: true }), '小可')
})

test('备注 helper 在公开语境始终使用真实昵称', () => {
  assert.equal(getFriendDisplayName({ nickname: '天才可鲁贝洛斯', friendRemark: '小可', isFriendContext: false }), '天才可鲁贝洛斯')
})

test('null/undefined/空字符串备注回退昵称', () => {
  for (const friendRemark of [null, undefined, '']) {
    assert.equal(getFriendDisplayName({ nickname: '真实昵称', friendRemark, isFriendContext: true }), '真实昵称')
  }
})

test('纯空格备注 trim 后回退昵称', () => {
  assert.equal(normalizeFriendRemark('   \t  '), null)
  assert.equal(getFriendDisplayName({ nickname: '真实昵称', friendRemark: '   ', isFriendContext: true }), '真实昵称')
})

test('备注模型保存 viewer 到 target 的单向关系', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model FriendRemark\s*\{[\s\S]*?ownerId\s+String[\s\S]*?friendId\s+String[\s\S]*?@@unique\(\[ownerId, friendId\]\)/)
})

test('备注写入使用当前 viewer 的 ownerId', () => {
  const route = read('app/api/friends/[userId]/remark/route.ts')
  assert.match(route, /ownerId: viewer\.id, friendId: target\.id/)
  assert.match(route, /normalizeFriendRemark\(sanitizeText\(body\.remark, 20\)\)/)
})

test('批量备注 resolver 查询 viewer-owned rows', () => {
  const resolver = read('lib/friend-remarks.ts')
  assert.match(resolver, /where: \{ ownerId: viewerId, friendId: \{ in: ids \}/)
})

test('批量备注 resolver 不读取 target 反向备注', () => {
  const resolver = read('lib/friend-remarks.ts')
  assert.match(resolver, /ownerId: viewerId/)
  assert.doesNotMatch(resolver, /ownerId: row\.friendId|ownerId: targetUserId/)
})

test('批量备注 resolver 排除当前用户本人', () => {
  const resolver = read('lib/friend-remarks.ts')
  assert.match(resolver, /id !== viewerId/)
})

test('好友列表正常分页读取批量备注 map', () => {
  const route = read('app/api/friends/list/route.ts')
  assert.match(route, /loadFriendRemarkMap\(user\.id, visibleFriendIds\)/)
  assert.match(route, /friendRemark: normalizedRemark/)
})

test('好友列表搜索会匹配当前用户自己的备注', () => {
  const route = read('app/api/friends/list/route.ts')
  assert.match(route, /prisma\.friendRemark\.findMany\(/)
  assert.match(route, /ownerId: currentUserId, remark: \{ contains: q \}/)
})

test('好友列表搜索只给实际 FRIEND 结果使用备注', () => {
  const route = read('app/api/friends/list/route.ts')
  assert.match(route, /relationshipStatus === 'FRIEND'/)
  assert.match(route, /loadFriendRemarkMap\(currentUserId, friendIds\)/)
})

test('好友 DTO 同时保留 nickname、friendRemark 和 displayName', () => {
  const types = read('lib/friend-types.ts')
  const route = read('app/api/friends/list/route.ts')
  assert.match(types, /nickname: string/)
  assert.match(types, /friendRemark\?: string \| null/)
  assert.match(types, /displayName: string/)
  assert.match(route, /displayName: getFriendDisplayName/)
})

test('好友资料卡使用统一 friend display helper', () => {
  const card = read('components/FriendProfileCard.tsx')
  assert.match(card, /getFriendDisplayName\(\{ nickname: friend\.nickname, friendRemark: friend\.friendRemark/)
  assert.match(card, /isFriendContext: status === 'FRIEND'/)
})

test('好友悬浮面板列表使用统一 friend display helper', () => {
  const dock = read('components/FriendDock.tsx')
  assert.match(dock, /const name = getFriendDisplayName\(\{ nickname: friend\.nickname, friendRemark: friend\.friendRemark/)
})

test('好友备注事件会同步 dock 的列表、分组、聊天和资料卡', () => {
  const dock = read('components/FriendDock.tsx')
  assert.match(dock, /friend-remark:updated/)
  assert.match(dock, /setGroupFriends\(\(groups\)/)
  assert.match(dock, /setChatFriend\(\(current\)/)
  assert.match(dock, /setProfileFriend\(\(current\)/)
})

test('私信会话 API 使用 viewer-scoped friend display helper', () => {
  const route = read('app/api/direct-conversations/route.ts')
  assert.match(route, /loadFriendRemarkMap\(user\.id, otherUserIds\)/)
  assert.match(route, /displayName: getFriendDisplayName/)
})

test('好友提及选择器使用备注且仍保留真实 nickname', () => {
  const route = read('app/api/friends/mentions/route.ts')
  const input = read('components/FriendMentionInput.tsx')
  assert.match(route, /nickname,/)
  assert.match(route, /friendRemark,/)
  assert.match(input, /getFriendDisplayName\(\{ nickname: friend\.nickname \|\| friend\.name/)
})

test('好友分组成员通过好友列表接口返回备注', () => {
  const dock = read('components/FriendDock.tsx')
  const route = read('app/api/friends/list/route.ts')
  assert.match(dock, /groupId/)
  assert.match(route, /requestedGroupId/)
  assert.match(route, /loadFriendRemarkMap\(user\.id, visibleFriendIds\)/)
})

test('挂号留言 API 只在 friends scope 开启私人备注上下文', () => {
  const route = read('app/api/checkin/messages/route.ts')
  assert.match(route, /friendContext: scope === 'friends'/)
})

test('挂号留言缓存 key 区分 public 和 friend context', () => {
  const service = read('lib/checkin-messages.ts')
  assert.match(service, /friendContext \? 'friend' : 'public'/)
})

test('挂号留言服务按批量 target ids 加载备注', () => {
  const service = read('lib/checkin-messages.ts')
  assert.match(service, /friendContext \? loadFriendRemarkMap\(viewerId, displayNameUserIds\)/)
})

test('挂号留言作者渲染使用 displayName 而非强制 nickname', () => {
  const service = read('lib/checkin-messages.ts')
  const panel = read('components/CheckInMessagesPanel.tsx')
  assert.match(service, /displayName: authorName/)
  assert.match(panel, /fullIdentity\?\.displayName \|\| fullIdentity\?\.nickname/)
})

test('挂号留言评论作者同样携带 viewer-scoped displayName', () => {
  const service = read('lib/checkin-messages.ts')
  const panel = read('components/CheckInMessagesPanel.tsx')
  assert.match(service, /displayName: getFriendDisplayName\(/)
  assert.match(panel, /author\.displayName \|\| author\.nickname/)
})

test('挂号留言点赞者使用批量备注 map', () => {
  const route = read('app/api/daily-messages/[messageId]/like/route.ts')
  const service = read('lib/checkin-messages.ts')
  assert.match(route, /loadFriendRemarkMap\(guard\.user\.id, likerIds\)/)
  assert.match(service, /likers: item\.DailyMessageLike\.map/)
})

test('点赞头像组件优先使用统一 friend display helper', () => {
  const component = read('components/LikeAvatars.tsx')
  assert.match(component, /getFriendDisplayName\(/)
  assert.match(component, /friendRemark: liker\.friendRemark/)
})

test('通知服务端动态解析 actor 备注，不改写持久化公共内容模型', () => {
  const service = read('lib/notifications.ts')
  assert.match(service, /loadFriendRemarkMap\(userId, actorIds\)/)
  assert.match(service, /actorName: actorDisplayName/)
})

test('通知列表备注变更会刷新当前 actor 文案和资料卡', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  assert.match(client, /friend-remark:updated/)
  assert.match(client, /setSelectedActor\(\(current\)/)
  assert.match(client, /refreshNotifications\(\)/)
})

test('游戏邀请列表使用备注，公共房间名称使用协议 nickname', () => {
  const duel = read('components/games/GuessSongDuel.tsx')
  assert.match(duel, /function friendName\(friend: Friend\)/)
  assert.match(duel, /getDuelDisplayName = \(player: \{ name: string \}\) => player\.name/)
})

test('个人主页强制读取 public nickname', () => {
  const profile = read('app/user/[uid]/page.tsx')
  assert.match(profile, /const name = getPublicUserDisplayName\(user\)/)
})

test('公开帖子详情不加载 viewer 的 friendRemark', () => {
  const page = read('app/posts/[postId]/page.tsx')
  const route = read('app/api/posts/[postId]/route.ts')
  assert.doesNotMatch(page, /loadFriendRemarkMap/)
  assert.doesNotMatch(route, /loadFriendRemarkMap/)
})

test('公开搜索不加载 viewer 的 friendRemark', () => {
  const route = read('app/api/search/route.ts')
  const page = read('app/search/page.tsx')
  assert.doesNotMatch(route, /loadFriendRemarkMap/)
  assert.doesNotMatch(page, /loadFriendRemarkMap/)
})

test('公开排行榜和公共游戏服务保持 nickname', () => {
  const ranking = read('lib/guess-song-leaderboard.ts')
  const duel = read('lib/guess-song-duel-service.ts')
  assert.doesNotMatch(ranking, /loadFriendRemarkMap|resolveFriendDisplayName/)
  assert.doesNotMatch(duel, /loadFriendRemarkMap|friendRemark/)
})

test('好友备注不会写入通知、私信或评论历史表', () => {
  const files = [read('app/api/friends/[userId]/remark/route.ts'), read('lib/notifications.ts'), read('app/api/direct-conversations/route.ts')].join('\n')
  assert.doesNotMatch(files, /friendRemark:.*Notification|friendRemark:.*DirectMessage|friendRemark:.*Comment/)
})

test('挂号留言备注查询不是逐条 query', () => {
  const service = read('lib/checkin-messages.ts')
  assert.match(service, /loadFriendRemarkMap\(viewerId, displayNameUserIds\)/)
  assert.doesNotMatch(service, /DailyMessageComment\.map\([\s\S]{0,300}friendRemark\.find/) 
})

test('删除或修改备注都复用同一 normalization 规则', () => {
  const route = read('app/api/friends/[userId]/remark/route.ts')
  const helper = read('lib/friend-display-name.ts')
  assert.match(route, /normalizeFriendRemark\(sanitizeText\(body\.remark, 20\)\)/)
  assert.match(helper, /const remark = value\.trim\(\)/)
})

