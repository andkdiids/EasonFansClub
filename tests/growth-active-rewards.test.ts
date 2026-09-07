import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getGrowthTask } from '@/lib/growth-tasks/registry'

const read = (path: string) => readFileSync(path, 'utf8')

test('帖子点赞行为奖励是服务端每日五次上限，自己点赞不进入奖励分支', () => {
  const route = read('app/api/posts/[postId]/like/route.ts')
  const service = read('lib/growth-tasks/service.ts')
  const definition = getGrowthTask('POST_LIKE_ACTIVE')
  assert.equal(definition?.reward, 1)
  assert.equal(definition?.dailyCap, 5)
  assert.equal(definition?.capUnit, 'events')
  assert.match(route, /taskCode: 'POST_LIKE_ACTIVE'/)
  assert.match(route, /if \(post\.authorId !== user\.id\)/)
  assert.match(route, /sourceEventId: `post:\$\{postId\}:date:\$\{dateKey\}`/)
  assert.match(service, /await tx\.\$queryRaw`SELECT.*User.*FOR UPDATE`/)
  assert.match(service, /const remaining = Math\.max\(0, window\.limit - used\)/)
  assert.match(service, /userId_taskCode_periodKey_sourceEventId/)
})

test('取消后同日重新点赞仍由同一帖子日期业务键幂等拦截', () => {
  const route = read('app/api/posts/[postId]/like/route.ts')
  const service = read('lib/growth-tasks/service.ts')
  assert.match(route, /if \(existing\) \{[\s\S]*return \{ isLiked: true, likeCount \}/)
  assert.match(route, /await tx\.like\.deleteMany\(\{ where: \{ postId, userId: user\.id \} \}\)/)
  assert.match(service, /if \(existing\) return \{ eligible: true, created: false, completion: existing \}/)
})

test('正式站内分享成功后才请求一次性每日分享奖励，打开分享方式不直接奖励', () => {
  const button = read('components/share/ShareButton.tsx')
  const endpoint = read('app/api/growth/actions/share/route.ts')
  const definition = getGrowthTask('CONTENT_SHARE_ACTIVE')
  assert.equal(definition?.reward, 2)
  assert.equal(definition?.dailyCap, 1)
  assert.match(button, /const result = await shareContent\(/)
  assert.match(button, /fetch\('\/api\/growth\/actions\/share'/)
  assert.match(button, /const suffix = awardedAmount > 0/)
  assert.match(endpoint, /taskCode: 'CONTENT_SHARE_ACTIVE'/)
  assert.match(endpoint, /getShanghaiDateKey\(now\)/)
  assert.match(endpoint, /content:\$\{digest\}:\$\{dateKey\}/)
  assert.match(endpoint, /enforceApiRateLimit/)
  assert.doesNotMatch(read('components/share/ShareMethodDialog.tsx'), /growth\/actions\/share/)
})
