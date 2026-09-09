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
  assert.match(button, /async function recordContentShare\(contentId: string\)/)
  assert.match(button, /const awardedAmount = await recordContentShare\(data\.contentId \|\| data\.url\)/)
  assert.match(button, /const suffix = awardedAmount > 0/)
  assert.match(endpoint, /recordContentShareTask\(tx, guard\.user\.id, now\)/)
  assert.match(readFileSync('lib/share-task.ts', 'utf8'), /taskCode: 'CONTENT_SHARE_ACTIVE'/)
  assert.match(readFileSync('lib/share-task.ts', 'utf8'), /sourceEventId: contentShareSourceEventId\(now\)/)
  assert.match(endpoint, /enforceApiRateLimit/)
  assert.doesNotMatch(read('components/share/ShareMethodDialog.tsx'), /growth\/actions\/share/)
})

test('分享卡片只在明确保存成功后复用同一分享任务，生成预览不直接记任务', () => {
  const button = read('components/share/ShareButton.tsx')
  const preview = read('components/share/ShareCardPreview.tsx')
  const generation = button.slice(button.indexOf('async function generateCard'), button.indexOf('async function shareLink'))
  assert.match(button, /async function recordCardShare\(\)/)
  assert.match(button, /onShareSuccess=\{\(\) => \{ void recordCardShare\(\) \}\}/)
  assert.match(preview, /onShareSuccess\?: \(\) => void \| Promise<void>/)
  assert.match(preview, /downloadShareCard\(event, image\)\.then\(async \(saved\) => \{ if \(saved\) await onShareSuccess\?\.\(\) \}\)/)
  assert.doesNotMatch(generation, /recordContentShare|recordCardShare/)
})
