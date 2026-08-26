import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getPublicUserDisplayName } from '../lib/friend-remarks'
import { validateNicknameValue } from '../lib/login-account'

const read = (path: string) => readFileSync(path, 'utf8')

test('公开展示名称只取 nickname，异常时不泄露 username', () => {
  assert.equal(
    getPublicUserDisplayName({ nickname: '新昵称', username: 'old_internal_name' }),
    '新昵称',
  )
  assert.equal(
    getPublicUserDisplayName({ nickname: '   ', username: 'old_internal_name' }),
    'E院用户',
  )
  assert.equal(
    getPublicUserDisplayName({ nickname: '违规真实昵称', nicknameModerationStatus: 'VIOLATION', nicknameViolationDisplay: null, username: 'old_internal_name' }),
    '违规用户',
  )

  const helper = read('lib/friend-remarks.ts')
  assert.match(helper, /user\.nickname\?\.trim\(\) \|\| PUBLIC_USER_FALLBACK_NAME/)
  assert.doesNotMatch(helper, /user\.username\b/)
})

test('帖子、评论、通知、排行榜和投稿 API 的公开身份链路使用 nickname', () => {
  const postRoute = read('app/api/posts/route.ts')
  const replyRoute = read('app/api/posts/[postId]/replies/route.ts')
  const notifications = read('lib/notifications.ts')
  const likeNotifications = read('lib/like-notifications.ts')
  const leaderboard = read('lib/guess-song-leaderboard.ts')
  const contributionRoute = read('app/api/admin/music/concerts/contributions/route.ts')
  const attribution = read('components/music/ConcertContributorAttribution.tsx')

  assert.match(postRoute, /nickname: getPublicUserDisplayName\(User\)/)
  assert.match(replyRoute, /nickname: getPublicUserDisplayName\(replyAuthor\)/)
  assert.match(notifications, /const actorNickname = actor \? getPublicUserDisplayName\(actor\)/)
  assert.match(notifications, /getFriendDisplayName\(/)
  assert.match(notifications, /const displayActorName = actorName \|\| '有人'/)
  assert.match(likeNotifications, /getPublicUserDisplayName\(latest\.User\)/)
  assert.match(leaderboard, /getPublicUserDisplayName/)
  assert.match(contributionRoute, /displayName: getPublicUserDisplayName\(item\.submitter\)/)
  assert.match(attribution, /contributor\.nickname/)

  for (const source of [postRoute, replyRoute, notifications, likeNotifications, leaderboard, contributionRoute, attribution]) {
    assert.doesNotMatch(source, /(?:user|User|author|actor|submitter|contributor)\.username\b/)
  }
})

test('注册、昵称编辑和 My Live 水印不再把昵称称为 username', () => {
  const register = read('app/register/RegisterForm.tsx')
  const profileEditor = read('app/profile/ProfileSettingsForm.tsx')
  const watermark = read('components/music/live/MyLivePhotoPanel.tsx')
  const authMe = read('app/api/auth/me/route.ts')
  const profileApi = read('app/api/users/me/route.ts')

  assert.match(register, /<span className="text-sm font-bold text-white">昵称<\/span>/)
  assert.doesNotMatch(register, /用户名 \/ 昵称/)
  assert.doesNotMatch(profileEditor, /newUsername/)
  assert.match(watermark, /你的昵称  UID:当前账号/)
  assert.doesNotMatch(authMe, /user\.username|username: user\.username/)
  assert.doesNotMatch(profileApi, /username: profile\.username/)
})

test('昵称校验错误使用昵称语义，登录账号校验仍保留内部语义', () => {
  assert.match(validateNicknameValue('bad name').error || '', /昵称/)
  assert.match(validateNicknameValue('a'.repeat(17)).error || '', /昵称/)
})

test('好友申请和对决邀请不使用过宽 User 查询或旧 name 回退', () => {
  const friendsPage = read('app/friends/page.tsx')
  const duel = read('components/games/GuessSongDuel.tsx')

  assert.match(friendsPage, /User_FriendRequest_senderIdToUser: \{ select: friendRequestUserSelect \}/)
  assert.match(friendsPage, /User_FriendRequest_receiverIdToUser: \{ select: friendRequestUserSelect \}/)
  assert.doesNotMatch(friendsPage, /include: \{ Profile: true \}/)
  assert.match(duel, /getPublicUserDisplayNameFromNickname\(friend\.nickname, '好友'\)/)
  assert.doesNotMatch(duel, /friend\.name/)
  assert.doesNotMatch(duel, /friend\.nickname\s*\|\|\s*friend\.name/)
})
