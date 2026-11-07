import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isReplyLikeSupported,
  normalizeReplyLikeResponse,
  resolveReplyLikeEndpoint,
  resolveReplyLikeTargetId,
} from '../lib/reply-like'
import { parseNotificationReplyTarget, type NotificationReplyTarget } from '../lib/notification-target'

// 真实行为测试：直接调用生产代码里的纯函数，断言真实返回值，而非读取源码字符串。
// 无需数据库 / 无需模块 mock：这些函数无副作用、无 IO，是前后端共用的决策层。

const post: NotificationReplyTarget = { kind: 'post', resourceId: 'post-1', parentId: 'reply-9' }
const daily: NotificationReplyTarget = { kind: 'daily-message', resourceId: 'message-1', parentId: 'comment-9', date: '2026-08-25' }
const wall: NotificationReplyTarget = { kind: 'profile-wall', resourceId: '00012', parentId: 'wallmsg-9' }
const feedback: NotificationReplyTarget = { kind: 'feedback', resourceId: 'fb-1', parentId: 'fbreply-9' }

test('isReplyLikeSupported：仅帖子回复 / 评论回复 / 留言墙支持快捷点赞，feedback 等不支持', () => {
  assert.equal(isReplyLikeSupported('post'), true)
  assert.equal(isReplyLikeSupported('daily-message'), true)
  assert.equal(isReplyLikeSupported('profile-wall'), true)
  assert.equal(isReplyLikeSupported('feedback'), false)
  assert.equal(isReplyLikeSupported(null), false)
  assert.equal(isReplyLikeSupported(undefined), false)
  assert.equal(isReplyLikeSupported('like'), false)
  assert.equal(isReplyLikeSupported(''), false)
})

test('resolveReplyLikeTargetId：三类回复的点赞目标恒为 focus（对方新回复），不是帖子 / 主留言 / 墙主人', () => {
  assert.equal(resolveReplyLikeTargetId(post), 'reply-9')
  assert.equal(resolveReplyLikeTargetId(daily), 'comment-9')
  assert.equal(resolveReplyLikeTargetId(wall), 'wallmsg-9')
  // 关键回归：返回值是 parentId（focus），绝不是 resourceId（被回复的原内容）。
  assert.notEqual(resolveReplyLikeTargetId(post), post.resourceId)
  assert.notEqual(resolveReplyLikeTargetId(daily), daily.resourceId)
  assert.notEqual(resolveReplyLikeTargetId(wall), wall.resourceId)
})

test('resolveReplyLikeTargetId：无目标 / 不支持类型 / focus 缺失 / 畸形链接（focus=原内容）一律不下发点赞目标', () => {
  assert.equal(resolveReplyLikeTargetId(null), null)
  assert.equal(resolveReplyLikeTargetId(undefined), null)
  assert.equal(resolveReplyLikeTargetId(feedback), null, 'feedback 无既有点赞能力，不应显示按钮')
  assert.equal(resolveReplyLikeTargetId({ kind: 'post', resourceId: 'post-1', parentId: '' }), null)
  assert.equal(resolveReplyLikeTargetId({ kind: 'post', resourceId: 'same', parentId: 'same' }), null)
})

test('parseNotificationReplyTarget → resolveReplyLikeTargetId：真实通知链接解析出的点赞目标 = 对方新回复 id', () => {
  const base = { id: 'n1', source: 'personal' as const, type: 'REPLY', targetUrl: null }
  const cases: Array<{ link: string; expectFocus: string; expectResource: string }> = [
    { link: '/posts/post-1?focus=reply-9', expectFocus: 'reply-9', expectResource: 'post-1' },
    { link: '/checkin?message=message-1&focus=comment-9', expectFocus: 'comment-9', expectResource: 'message-1' },
    { link: '/user/00012/wall?focus=wallmsg-9', expectFocus: 'wallmsg-9', expectResource: '00012' },
    { link: '/feedback/fb-1?focus=fbreply-9', expectFocus: 'fbreply-9', expectResource: 'fb-1' },
  ]
  for (const { link, expectFocus, expectResource } of cases) {
    const target = parseNotificationReplyTarget({ ...base, link })
    assert.ok(target, `应能解析 ${link}`)
    const likeTargetId = resolveReplyLikeTargetId(target)
    if (target.kind === 'feedback') {
      assert.equal(likeTargetId, null, 'feedback 回复不下发快捷点赞目标')
    } else {
      assert.equal(likeTargetId, expectFocus, `${link} 的点赞目标应是对方新回复 focus`)
      assert.notEqual(likeTargetId, expectResource, `${link} 不能点赞原内容`)
    }
  }
  // 无 focus 的链接不解析出回复目标 → 无点赞目标。
  assert.equal(parseNotificationReplyTarget({ ...base, link: '/posts/post-1' }), null)
})

test('resolveReplyLikeEndpoint：帖子回复 / 评论回复 POST 点赞、DELETE 取消（与详情页一致）', () => {
  assert.deepEqual(resolveReplyLikeEndpoint('post', 'reply-9', true), {
    url: '/api/replies/reply-9/like', method: 'POST',
  })
  assert.deepEqual(resolveReplyLikeEndpoint('post', 'reply-9', false), {
    url: '/api/replies/reply-9/like', method: 'DELETE',
  })
  assert.deepEqual(resolveReplyLikeEndpoint('daily-message', 'comment-9', true), {
    url: '/api/daily-message-comments/comment-9/like', method: 'POST',
  })
  assert.deepEqual(resolveReplyLikeEndpoint('daily-message', 'comment-9', false), {
    url: '/api/daily-message-comments/comment-9/like', method: 'DELETE',
  })
})

test('resolveReplyLikeEndpoint：留言墙为 POST 幂等切换（无独立 DELETE），点赞 / 取消均 POST', () => {
  assert.deepEqual(resolveReplyLikeEndpoint('profile-wall', 'wallmsg-9', true), {
    url: '/api/profile-wall/wallmsg-9/like', method: 'POST',
  })
  assert.deepEqual(resolveReplyLikeEndpoint('profile-wall', 'wallmsg-9', false), {
    url: '/api/profile-wall/wallmsg-9/like', method: 'POST',
  })
})

test('resolveReplyLikeEndpoint：目标 id 经过 encodeURIComponent，避免注入 / 破坏路径', () => {
  assert.equal(resolveReplyLikeEndpoint('post', 'a/b?c=1', true).url, '/api/replies/a%2Fb%3Fc%3D1/like')
  assert.equal(resolveReplyLikeEndpoint('profile-wall', 'x y', false).url, '/api/profile-wall/x%20y/like')
})

test('normalizeReplyLikeResponse：帖子回复 / 评论回复用 isLiked，留言墙用 liked，统一为 {liked,likeCount}', () => {
  assert.deepEqual(normalizeReplyLikeResponse('post', { isLiked: true, likeCount: 3 }), { liked: true, likeCount: 3 })
  assert.deepEqual(normalizeReplyLikeResponse('daily-message', { isLiked: false, likeCount: 0 }), { liked: false, likeCount: 0 })
  assert.deepEqual(normalizeReplyLikeResponse('profile-wall', { liked: true, likeCount: 7 }), { liked: true, likeCount: 7 })
  // 字段名混用时不误判：留言墙不认 isLiked，帖子回复不认 liked。
  assert.equal(normalizeReplyLikeResponse('profile-wall', { isLiked: true, likeCount: 1 }), null)
  assert.equal(normalizeReplyLikeResponse('post', { liked: true, likeCount: 1 }), null)
})

test('normalizeReplyLikeResponse：非法 / 缺失 / 非有限返回 null（调用方保留乐观值，不写坏状态）', () => {
  assert.equal(normalizeReplyLikeResponse('post', null), null)
  assert.equal(normalizeReplyLikeResponse('post', undefined), null)
  assert.equal(normalizeReplyLikeResponse('post', {}), null)
  assert.equal(normalizeReplyLikeResponse('post', { isLiked: 'true', likeCount: 1 }), null)
  assert.equal(normalizeReplyLikeResponse('post', { isLiked: true, likeCount: '3' }), null)
  assert.equal(normalizeReplyLikeResponse('post', { isLiked: true, likeCount: Number.NaN }), null)
  assert.equal(normalizeReplyLikeResponse('post', { isLiked: true, likeCount: Number.POSITIVE_INFINITY }), null)
  assert.deepEqual(normalizeReplyLikeResponse('profile-wall', { liked: false, likeCount: 2 }), { liked: false, likeCount: 2 })
})

test('端到端不变量：三类可点赞通知各自路由到既有模型对应的端点，且目标 = focus', () => {
  const base = { id: 'n1', source: 'personal' as const, type: 'REPLY', targetUrl: null }
  const scenarios: Array<{ link: string; url: string; method: string }> = [
    { link: '/posts/post-1?focus=reply-9', url: '/api/replies/reply-9/like', method: 'POST' },
    { link: '/checkin?message=message-1&focus=comment-9', url: '/api/daily-message-comments/comment-9/like', method: 'POST' },
    { link: '/user/00012/wall?focus=wallmsg-9', url: '/api/profile-wall/wallmsg-9/like', method: 'POST' },
  ]
  for (const { link, url, method } of scenarios) {
    const target = parseNotificationReplyTarget({ ...base, link })
    assert.ok(target)
    assert.ok(isReplyLikeSupported(target.kind))
    const focusId = resolveReplyLikeTargetId(target)
    assert.ok(focusId)
    const endpoint = resolveReplyLikeEndpoint(target.kind as 'post' | 'daily-message' | 'profile-wall', focusId, true)
    assert.equal(endpoint.url, url)
    assert.equal(endpoint.method, method)
    // 再次点击（取消）：帖子回复 / 评论回复 DELETE，留言墙仍 POST。
    const undo = resolveReplyLikeEndpoint(target.kind as 'post' | 'daily-message' | 'profile-wall', focusId, false)
    assert.equal(undo.method, target.kind === 'profile-wall' ? 'POST' : 'DELETE')
  }
})
