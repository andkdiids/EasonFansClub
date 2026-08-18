import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const manager = read('app/admin/posts/review/PostReviewManager.tsx')
const page = read('app/admin/posts/review/page.tsx')
const route = read('app/api/admin/posts/review/route.ts')

test('首次进入审核中心默认选中并请求待审核（PENDING）', () => {
  // 客户端默认状态为 PENDING
  assert.match(manager, /useState<ReviewStatus>\('PENDING'\)/)
  // 服务端首屏预取也只取 PENDING，保证默认数据与默认 Tab 一致
  assert.match(page, /where: \{ moderationStatus: 'PENDING', isDeleted: false \}/)
})

test('切换任一状态 Tab 均按该状态重新拉取列表', () => {
  // Tab 按钮点击时调用 loadStatus(status, 1)
  assert.match(manager, /onClick=\{\(\) => void loadStatus\(status, 1\)\}/)
  // GET 接口在缺少/非法 status 时回退为 PENDING，不会用到旧 status
  assert.match(route, /isPostModerationStatus\(rawStatus\) \? rawStatus : 'PENDING'/)
  // 列表请求禁用客户端缓存，避免使用上一轮 Tab 的缓存数据
  assert.match(manager, /cache: 'no-store'/)
  assert.match(route, /Cache-Control': 'private, no-store, max-age=0'/)
})

test('挂载时若初始列表与当前 Tab 不一致会按当前状态重拉，避免复用上一轮 Tab 数据', () => {
  // 存在按 queueStatus 触发的挂载/切换副作用
  assert.match(manager, /useEffect\(\(\) => \{[\s\S]*\}, \[queueStatus\]\)/)
  // 副作用内：检查初始列表状态是否与当前 queueStatus 一致
  assert.match(manager, /initialPosts\.some\(\(post\) => post\.moderationStatus !== queueStatus\)/)
  // 不一致时按当前状态重新拉取（修复「待审核 Tab 显示已通过列表」）
  assert.match(manager, /void loadStatus\(queueStatus, 1\)/)
})

test('四种审核状态均可作为 Tab 切换目标', () => {
  // postModerationStatuses 提供 PENDING/APPROVED/REJECTED/VIOLATION 四个 Tab
  assert.match(manager, /postModerationStatuses\.map\(\(status\) =>/)
  // 状态文案覆盖待审核 / 已通过 / 已拒绝 / 违规内容
  assert.match(manager, /PENDING: '待审核', APPROVED: '已通过', REJECTED: '已拒绝', VIOLATION: '违规内容'/)
})
