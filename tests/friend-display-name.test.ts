import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getFriendDisplayName } from '../lib/friend-remarks'

const read = (file: string) => readFileSync(file, 'utf8')

test('好友展示 helper 只在好友语境使用非空备注，空格备注回退昵称', () => {
  assert.equal(getFriendDisplayName({ nickname: '神仙鱼Flynn', friendRemark: ' 老陈 ', isFriendContext: true }), '老陈')
  assert.equal(getFriendDisplayName({ nickname: '神仙鱼Flynn', friendRemark: '   ', isFriendContext: true }), '神仙鱼Flynn')
  assert.equal(getFriendDisplayName({ nickname: '神仙鱼Flynn', friendRemark: '老陈', isFriendContext: false }), '神仙鱼Flynn')
  assert.equal(getFriendDisplayName({ nickname: '   ', friendRemark: '   ', isFriendContext: true }), 'E院用户')
})

test('好友列表 DTO 保留公开 nickname，并返回 friendRemark/displayName', () => {
  const route = read('app/api/friends/list/route.ts')
  const types = read('lib/friend-types.ts')
  const dock = read('components/FriendDock.tsx')

  assert.match(route, /nickname,\s*friendRemark: normalizedRemark,\s*displayName: getFriendDisplayName/)
  assert.match(route, /Profile\.displayName is a public profile field/)
  assert.match(types, /displayName: string/)
  assert.match(types, /friendRemark\?: string \| null/)
  assert.match(dock, /const name = friend\.displayName \|\| friend\.nickname/)
})

test('备注保存事件会即时同步好友列表、分组、聊天和资料卡 state', () => {
  const editor = read('components/FriendRemarkEditor.tsx')
  const dock = read('components/FriendDock.tsx')

  assert.match(editor, /friend-remark:updated/)
  assert.match(editor, /remark: nextRemark \|\| null/)
  assert.match(dock, /setGroupFriends\(\(groups\) => Object\.fromEntries/)
  assert.match(dock, /setChatFriend\(\(current\)/)
  assert.match(dock, /setProfileFriend\(\(current\)/)
})

test('私有联系人接口统一输出备注展示名，公开搜索和内容不查备注', () => {
  const conversations = read('app/api/direct-conversations/route.ts')
  const mentions = read('app/api/friends/mentions/route.ts')
  const activity = read('app/api/friends/activity/route.ts')
  const search = read('app/api/search/route.ts')
  const posts = read('app/api/posts/[postId]/route.ts')

  assert.match(conversations, /friendRemark:/)
  assert.match(conversations, /displayName: getFriendDisplayName/)
  assert.match(mentions, /displayName,/)
  assert.match(activity, /displayName: getFriendDisplayName/)
  assert.doesNotMatch(search, /loadFriendRemarkMap|resolveFriendDisplayName/)
  assert.doesNotMatch(posts, /loadFriendRemarkMap|resolveFriendDisplayName/)
})

test('通知和游戏邀请只在本地好友语境使用备注，房间/排行榜仍用公开昵称', () => {
  const notifications = read('lib/notifications.ts')
  const duel = read('components/games/GuessSongDuel.tsx')
  const privateRoomNames = read('app/api/friends/display-names/route.ts')
  const duelService = read('lib/guess-song-duel-service.ts')
  const leaderboard = read('lib/guess-song-leaderboard.ts')

  assert.match(notifications, /actorName: actorDisplayName/)
  assert.match(duel, /friend\.displayName\?\.trim\(\)/)
  assert.match(privateRoomNames, /loadFriendRemarkMap/)
  assert.match(duel, /hydratePrivateFriendDisplayNames/)
  assert.match(duel, /getDuelDisplayName/)
  assert.match(duelService, /name: getPublicUserDisplayName/)
  assert.doesNotMatch(duelService, /loadFriendRemarkMap|friendRemark/)
  assert.doesNotMatch(leaderboard, /loadFriendRemarkMap|resolveFriendDisplayName/)
})

test('备注查询按批量 map 加载，不对每个好友单独请求', () => {
  const helper = read('lib/friend-remarks.ts')
  const list = read('app/api/friends/list/route.ts')
  const conversations = read('app/api/direct-conversations/route.ts')
  const privateRoomNames = read('app/api/friends/display-names/route.ts')

  assert.match(helper, /prisma\.friendRemark\.findMany/)
  assert.match(helper, /friendId: \{ in: ids \}/)
  assert.match(list, /loadFriendRemarkMap\(user\.id, visibleFriendIds\)/)
  assert.match(conversations, /loadFriendRemarkMap\(user\.id, otherUserIds\)/)
  assert.match(privateRoomNames, /loadFriendRemarkMap\(guard\.user\.id, ids\)/)
  assert.doesNotMatch(list, /friends\.map\([\s\S]{0,300}friendRemark/)
})
