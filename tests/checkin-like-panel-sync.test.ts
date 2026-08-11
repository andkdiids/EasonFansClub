import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const panel = read('components/CheckInMessagesPanel.tsx')
const actions = read('components/DailyMessageActions.tsx')
const likeRoute = read('app/api/daily-messages/[messageId]/like/route.ts')

test('点赞接口事务内返回权威 isLiked / likeCount，且不会减成负数', () => {
  assert.match(likeRoute, /return \{ isLiked: !existing, likeCount \}/)
  assert.match(likeRoute, /dailyMessageLike\.count\(\{ where: \{ messageId \} \}\)/)
  // 取消点赞走 deleteMany（幂等，不存在时不会重复扣减）
  assert.match(likeRoute, /dailyMessageLike\.deleteMany\(\{ where: \{ messageId, userId: guard\.user\.id \} \}\)/)
})

test('面板同步 effect 不依赖不稳定的 likeCtx，点赞不再触发分页重置与旧数据覆盖', () => {
  assert.match(panel, /const likeCtxRef = useRef\(likeCtx\)/)
  // 初始数据同步 effect 只跟随真正的服务端 props 变化
  assert.match(panel, /\}, \[initialDate, initialMessages, initialPagination, initialSort\]\)/)
  assert.ok(!panel.includes('[initialDate, initialMessages, initialSort, likeCtx]'))
  // loadMessages 同样不把 likeCtx 列入依赖
  assert.match(panel, /\}, \[date, isLoading, page, scope, serverPaginated, sort\]\)/)
  assert.ok(!panel.includes('[date, isLoading, scope, sort, likeCtx]'))
  // 覆盖层刷新统一走 ref，避免 effect 因 likeCtx 身份变化而重跑
  assert.match(panel, /likeCtxRef\.current\.reconcileLikes/)
})

test('点赞使用乐观更新：先本地切换，成功后用接口权威值覆盖', () => {
  const toggleStart = actions.indexOf('async function toggleLike()')
  const fetchIndex = actions.indexOf("fetch(`/api/daily-messages/${messageId}/like`", toggleStart)
  const optimisticIndex = actions.indexOf('setIsLiked(optimisticLiked)', toggleStart)
  const serverIndex = actions.indexOf('setIsLiked(serverLiked)', fetchIndex)
  assert.ok(toggleStart > 0 && optimisticIndex > toggleStart && fetchIndex > optimisticIndex && serverIndex > fetchIndex)
  // 乐观计数不会小于 0
  assert.match(actions, /Math\.max\(previousLikes \+ \(optimisticLiked \? 1 : -1\), 0\)/)
})

test('点赞失败完整回滚本地状态并显示中文错误', () => {
  assert.match(actions, /setIsLiked\(previousLiked\)/)
  assert.match(actions, /setLikes\(previousLikes\)/)
  assert.match(actions, /onLikeChange\?\.\(\{ liked: previousLiked, likeCount: previousLikes \}\)/)
  assert.match(actions, /操作失败，请稍后再试/)
})

test('同一条留言点赞请求进行中禁止重复提交', () => {
  assert.match(actions, /const \[isLikePending, setIsLikePending\] = useState\(false\)/)
  assert.match(actions, /if \(isSubmitting \|\| isLikePending\) return/)
  assert.match(actions, /disabled=\{isSubmitting \|\| isLikePending\}/)
})
