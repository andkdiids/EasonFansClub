import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

// —— 统一删除服务 ——
const deletionService = read('lib/post-deletion.ts')
const singleRoute = read('app/api/posts/[postId]/route.ts')
const adminBulkRoute = read('app/api/admin/posts/bulk-delete/route.ts')
const userBulkRoute = read('app/api/users/me/posts/bulk-delete/route.ts')
const adminPermissions = read('lib/admin-permissions.ts')
const adminUserDeletion = read('lib/admin-user-deletion.ts')
// —— 管理员审核 / 列表 ——
const reviewManager = read('app/admin/posts/review/PostReviewManager.tsx')
const reviewPage = read('app/admin/posts/review/page.tsx')
const reviewRoute = read('app/api/admin/posts/review/route.ts')
// —— 个人主页 ——
const profileModules = read('components/PublicUserModules.tsx')
const postActions = read('components/PostActions.tsx')
const profileSurface = read('components/ProfilePageSurface.tsx')
const profileUserPage = read('app/user/[uid]/page.tsx')
const featureConfirmDialog = read('components/PostFeatureConfirmDialog.tsx')
const detailMenu = postActions.slice(postActions.indexOf('export function PostManagementMenu'), postActions.indexOf('export function PersonalPostPinMenu'))
const listActions = postActions.slice(postActions.indexOf('export function AdminPostActions'))

// ---------------------------------------------------------------------------
// FEATURE CONFIRM（所有管理员加精入口统一二次确认）
// ---------------------------------------------------------------------------
test('所有设为精华入口先弹统一确认框，确认后才发起请求', () => {
  assert.match(featureConfirmDialog, /'设为精华？'/)
  assert.match(featureConfirmDialog, /确认将这篇帖子设为精华吗？设为精华后将按照现有规则发放对应奖励。/)
  assert.match(featureConfirmDialog, /'取消精华？'/)
  assert.match(featureConfirmDialog, /确认取消这篇帖子的精华状态吗？/)
  assert.match(featureConfirmDialog, /'确认设为精华'/)
  assert.match(featureConfirmDialog, /'确认取消精华'/)

  assert.match(detailMenu, /requestFeatureChange\(!isFeatured\)/)
  assert.match(detailMenu, /<PostFeatureConfirmDialog/)
  assert.match(listActions, /onClick=\{\(\) => setFeatureConfirm\(!isFeatured\)\}/)
  assert.match(listActions, /<PostFeatureConfirmDialog/)
  assert.match(reviewManager, /nextIsFeatured: true/)
  assert.match(reviewManager, /toggleFlag\(featureConfirm\.postId, 'isFeatured', featureConfirm\.nextIsFeatured\)/)
  assert.doesNotMatch(detailMenu, /onClick=\{\(\) => void updatePost\(\{ isFeatured: !isFeatured \}\)\}/)
  assert.doesNotMatch(listActions, /onClick=\{\(\) => updatePost\(\{ isFeatured: !isFeatured \}\)\}/)
})

test('加精与取消精华请求期间 loading + disabled，且服务端幂等逻辑保留', () => {
  assert.match(detailMenu, /loading=\{isSubmitting\}/)
  assert.match(listActions, /loading=\{isSubmitting\}/)
  assert.match(reviewManager, /flaggingId/)
  assert.match(reviewManager, /if \(flaggingId \|\| reviewingId\) return/)
  assert.match(reviewManager, /loading=\{Boolean\(flaggingId\)\}/)
  // 已加精的帖子显示「取消精华」而不是重复加精
  assert.match(reviewManager, /post\.isFeatured \? \(/)
  assert.match(reviewManager, /取消精华/)
  assert.match(reviewManager, /nextIsFeatured: false/)
  assert.match(detailMenu, /onCancel=\{\(\) => setFeatureConfirm\(null\)\}/)
  assert.match(listActions, /onCancel=\{\(\) => setFeatureConfirm\(null\)\}/)
  assert.match(reviewManager, /onCancel=\{\(\) => setFeatureConfirm\(null\)\}/)
  // 奖励发放幂等（业务键去重）仍在既有加精语义中，不在本次删除改动中破坏
  assert.doesNotMatch(deletionService, /awardFeaturedPostRewards/)
  assert.doesNotMatch(deletionService, /reward/)
})

test('ADMIN 可加精普通用户帖；管理身份作者帖仅超级管理员可加精（服务端 403）', () => {
  // 服务端真实权限校验：复用 isSuperAdmin / isPrivilegedPostAuthor，不写死 role === 'ADMIN'
  assert.match(adminPermissions, /export function isPrivilegedPostAuthor/)
  assert.match(adminPermissions, /'ADMIN' \|\| role === 'MODERATOR' \|\| role === 'SUPER_ADMIN'/)
  assert.match(singleRoute, /isPrivilegedPostAuthor\(existing\.User\?\.role\) && !isSuperAdmin\(guard\.user\)/)
  assert.match(singleRoute, /POST_FEATURE_PRIVILEGED_FORBIDDEN/)
  assert.match(singleRoute, /status: 403/)
  // 取消精华不受新规则影响
  assert.match(singleRoute, /取消精华不受影响/)
  assert.doesNotMatch(singleRoute, /role === "ADMIN"/)
  // 加精只读锁 + 幂等（已加精重复加精不会重复发奖）
  assert.match(singleRoute, /FOR UPDATE/)
  assert.match(singleRoute, /awardFeaturedPostRewards/)
  assert.match(singleRoute, /data\.isFeatured === true && !lockedExisting\.isFeatured/)
})

test('管理端前端按操作者角色隐藏/禁用加精入口（服务端 403 仍必须存在）', () => {
  assert.match(reviewManager, /isPrivilegedAuthorRole\(post\.User\?\.role\)/)
  assert.match(reviewManager, /仅超管可加精/)
  assert.match(reviewPage, /currentUserRole=\{currentUser\?\.role \?\? null\}/)
  assert.match(reviewRoute, /role: true/)
  assert.match(singleRoute, /User: \{ select: \{ role: true \} \}/)
})

// ---------------------------------------------------------------------------
// ADMIN KEYWORD SEARCH
// ---------------------------------------------------------------------------
test('审核列表 GET 支持 keyword（trim / 空恢复 / 中文可用 / 组合 status+page）', () => {
  assert.match(reviewRoute, /searchParams\.get\('keyword'\) \|\| ''\)\.trim\(\)/)
  assert.match(reviewRoute, /title: \{ contains: keyword \}/)
  assert.match(reviewRoute, /content: \{ contains: keyword \}/)
  assert.match(reviewRoute, /User: \{ nickname: \{ contains: keyword \} \}/)
  // 数字关键字可精确匹配帖子 ID 与作者 UID
  assert.match(reviewRoute, /\/\^\\d\+\$\/\.test\(keyword\)/)
  assert.match(reviewRoute, /id: \{ equals: keyword \}/)
  assert.match(reviewRoute, /User: \{ uid: Number\(keyword\) \}/)
  // 空 keyword 时 filter 为空对象（恢复默认列表）
  assert.match(reviewRoute, /: \{\}/)
})

test('搜索结果分页且页码夹紧（删空页自动回退最后一个有效页）', () => {
  assert.match(reviewRoute, /POST_REVIEW_PAGE_SIZE/)
  assert.match(reviewRoute, /const totalPages = Math\.max\(1, Math\.ceil\(total \/ POST_REVIEW_PAGE_SIZE\)\)/)
  assert.match(reviewRoute, /const safePage = Math\.min\(page, totalPages\)/)
  assert.match(reviewRoute, /keyword,/)
})

test('管理员审核列表保留 keyword/status/page 重新加载与关键词清除', () => {
  assert.match(reviewManager, /params\.set\('keyword', keyword\.trim\(\)\)/)
  assert.match(reviewManager, /void loadStatus\(queueStatus, 1\)/)
  assert.match(reviewManager, /清除/)
})

// ---------------------------------------------------------------------------
// REVIEW PAGE ACTIONS
// ---------------------------------------------------------------------------
test('审核页不暴露批量删除，也不保留仅服务于它的多选框和确认弹窗', () => {
  assert.doesNotMatch(reviewManager, /批量删除/)
  assert.doesNotMatch(reviewManager, /bulk-delete/)
  assert.doesNotMatch(reviewManager, /bulkDeleting|bulkConfirmOpen|confirmBulkDelete/)
  assert.doesNotMatch(reviewManager, /selectedIds|selectedCount|toggleSelect|本页全选|已选择/)
  assert.doesNotMatch(reviewManager, /type="checkbox"/)
  assert.doesNotMatch(reviewManager, /<ConfirmDialog/)
})

test('审核页的单条审核与其他合法管理操作仍保留', () => {
  assert.match(reviewManager, /requestReview\(post, 'APPROVED'\)/)
  assert.match(reviewManager, /requestReview\(post, 'REJECTED'\)/)
  assert.match(reviewManager, /void toggleFlag\(post\.id, 'isPinned', !post\.isPinned\)/)
  assert.match(reviewManager, /<PostFeatureConfirmDialog/)
})

// ---------------------------------------------------------------------------
// ADMIN BULK DELETE API（权限 / 服务复用 / 审计 / 幂等）
// ---------------------------------------------------------------------------
test('管理员批量删除：登录 + post_manage 权限、非空校验、逐篇复用 deletePost', () => {
  assert.match(adminBulkRoute, /requireAdmin\('post_manage'\)/)
  assert.match(adminBulkRoute, /postIds 必须是数组/)
  assert.match(adminBulkRoute, /请至少选择一篇帖子/)
  assert.match(adminBulkRoute, /单次最多删除/)
  assert.match(adminBulkRoute, /await deletePost\(\{ postId, actor: guard\.user, canManagePosts: true, reason: '管理员批量删除' \}\)/)
})

test('每篇记录既有 DELETE_POST 审计，不新增 BATCH_DELETE，不 Post.deleteMany', () => {
  assert.match(deletionService, /action: 'DELETE_POST' as const/)
  assert.match(deletionService, /adminAuditOperations\.POST_DELETED/)
  assert.match(adminBulkRoute, /createAdminActionAudit\(prisma, result\.audit\)/)
  assert.doesNotMatch(adminBulkRoute, /'BATCH_DELETE'|adminAuditOperations\.BATCH_DELETE|operationType:\s*'BATCH_DELETE'/)
  assert.doesNotMatch(adminBulkRoute, /deleteMany/)
  assert.doesNotMatch(adminBulkRoute, /Post\.delete/)
  assert.doesNotMatch(userBulkRoute, /deleteMany/)
})

test('批量删除返回真实成功/失败数量与失败原因', () => {
  assert.match(adminBulkRoute, /deleted: deletedIds\.length/)
  assert.match(adminBulkRoute, /failed: errors\.length/)
  assert.match(adminBulkRoute, /errors,/)
  assert.match(userBulkRoute, /deleted: deletedIds\.length/)
  assert.match(userBulkRoute, /failed: errors\.length/)
})

// ---------------------------------------------------------------------------
// USER BULK DELETE（管理模式的批量删除）
// ---------------------------------------------------------------------------
test('个人主页发帖记录有「管理」模式：checkbox、本页全选、计数、删除按钮、完成', () => {
  assert.match(profileModules, /manageMode, setManageMode/)
  assert.match(profileModules, />管理</)
  assert.match(profileModules, /本页全选/)
  assert.match(profileModules, /已选择 \{selectedPostIds\.size\} 篇/)
  assert.match(profileModules, />完成</)
  assert.match(profileModules, /confirmBulkDeleteUserPosts/)
  assert.match(profileModules, /批量删除帖子/)
})

test('用户批量删除 API：登录校验 + 逐篇归属校验，混入他人帖子整体 403', () => {
  assert.match(userBulkRoute, /requireUser\(\)/)
  assert.match(userBulkRoute, /ownedById\.get\(id\) !== guard\.user!\.id/)
  assert.match(userBulkRoute, /notOwned\.length > 0/)
  assert.match(userBulkRoute, /status: 403/)
  assert.match(userBulkRoute, /只能删除自己发布的帖子/)
  assert.match(userBulkRoute, /rejectedIds: notOwned/)
  // 通过校验后逐篇调用统一服务（canManagePosts=false，不写管理员审计）
  assert.match(userBulkRoute, /await deletePost\(\{ postId, actor: guard\.user, canManagePosts: false \}\)/)
  // 单篇已删除（并发下）只记失败不 500
  assert.match(userBulkRoute, /POST_ALREADY_DELETED/)
})

test('用户删除成功后仅就地刷新列表，不跳首页/广场/详情', () => {
  // #4 单帖删除回调只刷新 posts 页
  assert.match(profileModules, /onDeleted=\{onProfilePostDeleted\}/)
  const deleteCb = profileModules.slice(profileModules.indexOf('function handleProfilePostDeleted'))
  assert.match(deleteCb, /loadModule\('posts', modulePages\.posts, false, postGroupFilter\)/)
  assert.doesNotMatch(deleteCb, /router\.(push|replace)/)
  // #3 批量删除成功也仅刷新当前发帖记录页
  const bulkConfirmCb = profileModules.slice(profileModules.indexOf('async function confirmBulkDeleteUserPosts'))
  assert.match(bulkConfirmCb, /loadModule\('posts', modulePages\.posts, false, postGroupFilter\)/)
  assert.doesNotMatch(bulkConfirmCb, /router\.(push|replace)/)
  // 组件内绝无把个人主页替换到首页 / 广场的逻辑
  assert.doesNotMatch(profileModules, /router\.(push|replace)\("\//)
  assert.doesNotMatch(profileModules, /router\.(push|replace)\('\/'/)
  // PersonalPostPinMenu 的删除实现也不含路由跳转
  const pinMenu = postActions.slice(postActions.indexOf('export function PersonalPostPinMenu'), postActions.indexOf('export function AdminPostActions'))
  assert.doesNotMatch(pinMenu, /router\.(push|replace)/)
})

test('个人主页帖子「...」菜单包含「删除帖子」，且删除有二次确认', () => {
  assert.match(profileModules, /<PersonalPostPinMenu/)
  assert.match(postActions, /export function PersonalPostPinMenu/)
  const pinMenu = postActions.slice(postActions.indexOf('export function PersonalPostPinMenu'), postActions.indexOf('export function AdminPostActions'))
  assert.match(pinMenu, /删除帖子/)
  assert.match(pinMenu, /setConfirmDelete\(true\)/)
  assert.match(pinMenu, /method: 'DELETE'/)
  assert.match(pinMenu, /onDeleted\?\.\(\)/)
  assert.match(pinMenu, /<ConfirmDialog/)
  assert.match(pinMenu, /title="删除帖子"/)
  assert.match(pinMenu, /loading=\{isSubmitting\}/)
  assert.match(pinMenu, /isPinned \? '取消置顶' : '置顶'/)
})

// ---------------------------------------------------------------------------
// UNIFIED DELETE SERVICE 语义
// ---------------------------------------------------------------------------
test('deletePost 统一服务：软删除 + deletedAt + profilePinnedAt 清空 + 板块计数重算', () => {
  assert.match(deletionService, /export async function deletePost/)
  assert.match(deletionService, /isDeleted: true, deletedAt: new Date\(\), profilePinnedAt: null/)
  assert.match(deletionService, /FOR UPDATE/)
  assert.match(deletionService, /tx\.board\.update\(\{ where: \{ id: lockedExisting\.boardId \}, data: \{ postCount \} \}\)/)
})

test('deletePost 保留归属校验与幂等（已删除安全），不新增经济回滚/通知删除', () => {
  assert.match(deletionService, /POST_DELETE_FORBIDDEN/)
  assert.match(deletionService, /POST_ALREADY_DELETED/)
  assert.match(deletionService, /POST_NOT_FOUND/)
  assert.doesNotMatch(deletionService, /notification\.deleteMany/)
  assert.doesNotMatch(deletionService, /rollback|回滚/)
  assert.doesNotMatch(deletionService, /experience|experienceChange/)
})

test('管理员删除用户业务（admin-user-deletion）未纳入统一删除、未被改动', () => {
  assert.doesNotMatch(adminUserDeletion, /post-deletion/)
  assert.doesNotMatch(adminUserDeletion, /lib\/post-deletion/)
})

// ---------------------------------------------------------------------------
// PROFILE RETURN STATE（URL searchParams + sessionStorage scroll cache）
// ---------------------------------------------------------------------------
test('个人主页 Tab/页码/分组状态写入 URL（?module=posts&page=2）', () => {
  assert.match(profileModules, /params\.set\('module', active\)/)
  assert.match(profileModules, /params\.set\('page', String\(modulePages\.posts\)\)/)
  assert.match(profileModules, /params\.set\('groupId', postGroupFilter\)/)
  assert.match(profileModules, /router\.replace\(target, \{ scroll: false \}\)/)
  assert.match(profileModules, /new URLSearchParams\(window\.location\.search\)/)
})

test('浏览器前进/后退（popstate）按 URL 恢复 Tab/页码/分组', () => {
  assert.match(profileModules, /window\.addEventListener\('popstate', syncStateFromUrl\)/)
  assert.match(profileModules, /window\.removeEventListener\('popstate', syncStateFromUrl\)/)
  assert.match(profileModules, /setModulePages\(\(current\) => \(current\.posts === urlPage \? current : \{ \.\.\.current, posts: urlPage \}\)\)/)
})

test('服务端把 URL 的 module/page/groupId 透传给客户端初始状态', () => {
  assert.match(profileUserPage, /searchParams: Promise<Record<string, string \| string\[\] \| undefined>>/)
  assert.match(profileUserPage, /typeof sp\.module === 'string' \? sp\.module : undefined/)
  assert.match(profileUserPage, /initialModule=\{urlModule\}/)
  assert.match(profileUserPage, /initialPage=\{urlPage\}/)
  assert.match(profileUserPage, /initialGroupId=\{urlGroupId\}/)
  assert.match(profileSurface, /initialModule=\{initialModule\}/)
  assert.match(profileSurface, /initialPage=\{initialPage\}/)
  assert.match(profileSurface, /initialGroupId=\{initialGroupId\}/)
  assert.match(profileModules, /initialModule === 'posts' \? Math\.max\(1, Math\.trunc\(initialPage \|\| 1\) \|\| 1\) : 1/)
})

test('进入详情前 sessionStorage 缓存 scrollY，返回后按 URL 匹配恢复滚动', () => {
  assert.match(profileModules, /profile-scroll:\$\{uid\}/)
  assert.match(profileModules, /window\.sessionStorage\.setItem\(scrollRestoreKey/)
  assert.match(profileModules, /y: window\.scrollY/)
  assert.match(profileModules, /window\.scrollTo\(\{ top: saved\.y, behavior: 'auto' \}\)/)
  assert.match(profileModules, /window\.sessionStorage\.removeItem\(scrollRestoreKey\)/)
})

test('刷新个人主页带 page 参数仍能打开正确页（发帖记录 Tab 保持）', () => {
  assert.match(profileModules, /initialModule && ALL_MODULE_KEYS\.includes\(initialModule as ModuleKey\)/)
  assert.match(profileModules, /current === urlModule \? current : \(urlModule as ModuleKey\)\)/)
})

// ---------------------------------------------------------------------------
// REGRESSION / GUARDS
// ---------------------------------------------------------------------------
test('既有帖子审核与列表渲染仍保留（通过/拒绝/发布分区/图片查看器）', () => {
  assert.match(reviewManager, /requestReview\(post, 'APPROVED'\)/)
  assert.match(reviewManager, /requestReview\(post, 'REJECTED'\)/)
  assert.match(reviewManager, /void toggleFlag\(post\.id, 'isPinned', !post\.isPinned\)/)
  assert.match(reviewManager, /<ImageViewer/)
  assert.match(reviewManager, /发布分区：/)
})

test('置顶/取消置顶入口仍可用，个人置顶回调保留分页刷新', () => {
  assert.match(profileModules, /<PersonalPostPinMenu/)
  const pinMenu = postActions.slice(postActions.indexOf('export function PersonalPostPinMenu'), postActions.indexOf('export function AdminPostActions'))
  assert.match(pinMenu, /isPinned \? '取消置顶' : '置顶'/)
  assert.match(profileModules, /loadModule\('posts', 1\)/)
})

test('删除语义与现有 executePostDelete 对齐：不回滚挂号费/经验/精华奖励（回归锚点）', () => {
  // 统一服务里没有任何回滚或额外经济操作
  assert.doesNotMatch(deletionService, /clinic|appointment|fee|挂号/)
  assert.doesNotMatch(deletionService, /notification/)
  // 单帖删除仍走 POST /api/posts/:id（统一服务）
  assert.match(singleRoute, /deletePost\(\{ postId, actor: user, canManagePosts \}\)/)
})

// 引用该源文件时的基础保障：Schema 未改动、无新增迁移要求
test('无 schema / 迁移改动', () => {
  const schema = read('prisma/schema.prisma')
  assert.doesNotMatch(schema, /BATCH_DELETE/)
})
