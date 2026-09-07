import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const reviewRoute = read('app/api/admin/posts/review/route.ts')
const reviewManager = read('app/admin/posts/review/PostReviewManager.tsx')
const reviewPage = read('app/admin/posts/review/page.tsx')
const patch = reviewRoute.slice(reviewRoute.indexOf('export async function PATCH'))
const transaction = reviewRoute.slice(reviewRoute.indexOf('prisma.$transaction'), reviewRoute.indexOf('const current = result.current'))

test('CASE 7/10 只有拥有 post_manage 的管理员能审核/调整发布分区（服务端权限复检）', () => {
  assert.match(reviewRoute, /const guard = await requireAdmin\('post_manage'\)/)
  const guards = (reviewRoute.match(/await requireAdmin\('post_manage'\)/g) || []).length
  assert.ok(guards >= 2, `expected GET+PATCH 都做权限校验, got ${guards}`)
})

test('CASE 7 发布分区只从真实分区数据源解析，配置分区落库为真实 Board，杜绝硬编码', () => {
  assert.match(reviewRoute, /getConfiguredForumBoardBySelectionId\(selectionId\)/)
  assert.match(reviewRoute, /prisma\.board\.upsert/)
  assert.match(reviewRoute, /prisma\.board\.findFirst\(\{\s*where: \{ id: selectionId, isActive: true \}/)
  assert.doesNotMatch(reviewRoute, /boardSelectionId === '小臣书'|name: '小臣书'|slug: 'xiaochenshu'/)
  assert.match(reviewPage, /mergeForumBoardOptions\(boardRows\)/)
  assert.match(reviewPage, /where: \{ isActive: true \}/)
})

test('CASE 7 不存在的或已停用分区 → 服务端 400 拒绝', () => {
  assert.match(patch, /const boardTarget = boardSelectionId \? await resolveReviewBoardTarget\(boardSelectionId\) : null/)
  assert.match(patch, /if \(boardSelectionId && !boardTarget\) \{/)
  assert.match(patch, /'板块不存在或已停用，无法发布到该分区'/)
  assert.match(patch, /status: 400/)
})

test('CASE 2/9/1 分区只在「通过审核」事务内写入 Post.boardId，且与审核状态同事务', () => {
  // 分区变更发生在 writeReviewNotification/审核副作用之前的事务闭包里
  assert.ok(transaction.indexOf('boardChanged') > 0)
  assert.match(transaction, /const finalBoardId = boardTarget\?\.id \|\| current\.boardId/)
  assert.match(transaction, /const boardChanged = status === 'APPROVED' && finalBoardId !== current\.boardId/)
  assert.match(transaction, /\.\.\.\(boardChanged \? \{ boardId: finalBoardId \} : \{\}\)/)
  assert.match(transaction, /data: updateData,/)
  assert.ok(transaction.indexOf('tx.post.updateMany') > 0)
})

test('CASE 5 拒绝不修改分区（boardChanged 要求 status==APPROVED；拒绝请求即使带分区也忽略）', () => {
  assert.match(patch, /const boardSelectionId = status === 'APPROVED' && typeof body\?\.boardId === 'string'/)
  assert.match(transaction, /status === 'APPROVED' && finalBoardId !== current\.boardId/)
  assert.doesNotMatch(transaction, /boardChanged: true/)
})

test('CASE 6 未通过审核直接退出不落库：分区选择仅存前端 state，无任何提前写入请求', () => {
  assert.match(reviewManager, /publishBoardByPostId/)
  assert.match(reviewManager, /setPublishBoardByPostId\(\{\}\)/)
  // select 变更只更新本地 state，不触发网络请求
  const onChangeBlock = reviewManager.slice(reviewManager.indexOf('onChange={(event) => {'), reviewManager.indexOf('className="max-w-56'))
  assert.doesNotMatch(onChangeBlock, /fetch\(|method:\s*'PATCH'/)
})

test('CASE 1/3/4 审核通过时仅当分区变化才提交 boardId，最终分区与提交一致', () => {
  assert.match(reviewManager, /const boardChanged = status === 'APPROVED' && Boolean\(publishBoardId\) && currentPost && publishBoardId !== currentPost\.boardId/)
  assert.match(reviewManager, /\.\.\.\(boardChanged \? \{ boardId: publishBoardId \} : \{\}\)/)
  assert.match(reviewManager, /publishBoardByPostId\[target\.postId\]/)
  assert.match(reviewManager, /target\.nextStatus === 'APPROVED' \? chosenBoardId : undefined/)
  // 服务端用提交的最终分区回写
  assert.match(transaction, /finalBoardName = boardTarget\?\.name \|\| current\.Board\?\.name/)
})

test('CASE 3/4/6 通知必须用真实标题与真实原/最终分区名，且明确 A → B', () => {
  assert.match(reviewRoute, /`你的帖子《\$\{input\.title\}》已通过审核，并发布至「\$\{input\.finalBoardName \|\| 'E院广场'\}」。`/)
  assert.match(reviewRoute, /我们已将帖子从「\$\{input\.originalBoardName\}」调整至「\$\{input\.finalBoardName\}」/)
  assert.match(reviewRoute, /帖子现已发布至「\$\{input\.finalBoardName\}」/)
  assert.match(reviewRoute, /link: `\/posts\/\$\{input\.postId\}`/)
})

test('CASE 6/9 审核通过通知与分区审计元数据包含 original/final/categoryChanged', () => {
  assert.match(reviewRoute, /originalCategoryId: input\.category\.originalBoardId/)
  assert.match(reviewRoute, /finalCategoryId: input\.category\.finalBoardId/)
  assert.match(reviewRoute, /categoryChanged: input\.category\.changed/)
})

test('CASE 9 分区变动后旧/新两分区都刷新 postCount', () => {
  assert.match(reviewRoute, /await refreshReviewBoardCount\(current\.boardId, postId, action\)/)
  assert.match(reviewRoute, /if \(result\.boardChanged\) \{\s*await refreshReviewBoardCount\(result\.finalBoardId, postId, action\)/)
})

test('CASE 2/13 管理员界面显示原分区且「发布分区」默认等于当前真实分区，选项来自真实数据源', () => {
  assert.match(reviewManager, /投稿分区：/)
  assert.match(reviewManager, /发布分区：/)
  assert.match(reviewManager, /const selectedBoardId = publishBoardByPostId\[post\.id\] \|\| post\.boardId/)
  assert.match(reviewManager, /已调整分区：/)
  assert.match(reviewManager, /boardOptions\.map\(\(board\) => <option/)
  assert.match(reviewManager, /boards: ReviewBoardOption\[\]/)
  // 卡片标题/正文/历史等其它内容仍来自帖子本身，不因分区选择改动
  assert.match(reviewManager, /\{post\.title\}/)
})

test('CASE 5/8 服务端列表与详情始终以 Post.boardId（当前真实分区）为准', () => {
  // 审核列表显式返回 boardId，卡片默认值读取该真实字段，而非 URL/缓存
  assert.match(reviewRoute, /boardId: true,/)
  assert.match(reviewManager, /boardId: string/)
  assert.match(reviewPage, /boardId: true,/)
  assert.match(reviewPage, /getForumBoardDisplayName\(post\.Board\)/)
})
