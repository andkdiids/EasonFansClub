import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getPublicUserDisplayName } from '../lib/friend-remarks'

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
  const leaderboard = read('lib/guess-song-leaderboard.ts')
  const contributionRoute = read('app/api/admin/music/concerts/contributions/route.ts')
  const attribution = read('components/music/ConcertContributorAttribution.tsx')

  assert.match(postRoute, /nickname: getPublicUserDisplayName\(User\)/)
  assert.match(replyRoute, /nickname: getPublicUserDisplayName\(replyAuthor\)/)
  assert.match(notifications, /fallbackName: getPublicUserDisplayName\(actor\)/)
  assert.match(leaderboard, /getPublicUserDisplayName/)
  assert.match(contributionRoute, /displayName: getPublicUserDisplayName\(item\.submitter\)/)
  assert.match(attribution, /contributor\.nickname/)

  for (const source of [postRoute, replyRoute, notifications, leaderboard, contributionRoute, attribution]) {
    assert.doesNotMatch(source, /(?:user|User|author|actor|submitter|contributor)\.username\b/)
  }
})
