import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizePostReturnTo, postBackHref, postDetailHref, postEditHref } from '@/lib/post-navigation'

const read = (path: string) => readFileSync(path, 'utf8')
const route = read('app/api/posts/[postId]/route.ts')
const editHandler = route.slice(route.indexOf('async function handleEditPost'))
const form = read('components/PostEditForm.tsx')
const detail = read('app/posts/[postId]/page.tsx')
const actions = read('components/PostActions.tsx')
const editPage = read('app/posts/[postId]/edit/page.tsx')
const discoveryHome = read('components/ForumDiscoveryHome.tsx')
const fishPreview = read('components/ForumFishModePreview.tsx')
const detailTopbar = read('components/ForumDiscoveryDetailTopbar.tsx')

test('post detail management menu exposes the existing edit flow in permission order', () => {
  assert.match(detail, /postActions=\{canManagePost \|\| canDeletePost \|\| canEditPost \?/)
  assert.match(detail, /canEdit=\{canEditPost\}/)
  assert.match(detail, /returnTo=\{returnTo\}/)
  assert.match(actions, /canEdit: boolean/)
  assert.match(actions, /router\.push\(postEditHref\(postId, returnTo\)\)/)
  const menu = actions.slice(actions.indexOf('className="post-management-menu-panel"'))
  assert.ok(menu.indexOf('{canEdit ?') < menu.indexOf('{canManage ?'))
  assert.ok(menu.indexOf('{canManage ?') < menu.indexOf('{canDelete ?'))
})

test('帖子编辑使用真实 PATCH 路由、白名单字段并保留帖子身份', () => {
  assert.match(route, /export async function PATCH\(request: Request, \{ params \}: Params\)/)
  assert.match(form, /fetch\(`\/api\/posts\/\$\{postId\}`,[\s\S]*method: 'PATCH'/)
  assert.match(form, /JSON\.stringify\(\{ title, content, richContent, boardId, keepMediaIds, addImageUrls \}\)/)
  assert.match(form, /removePendingPostFromDiscoverySessions/)
  assert.match(form, /data\?\.moderationStatus === 'PENDING'/)
  assert.doesNotMatch(editHandler, /body\.(id|authorId|createdAt|updatedAt|likeCount|replyCount|ipRegion|moderationStatus)/)
  assert.match(editHandler, /data: \{[\s\S]*title: rawTitle,[\s\S]*content: rawContent,[\s\S]*summary: createSummary\(rawContent\),[\s\S]*boardId: nextBoardId/)
})

test('普通用户编辑沿用审核规则，但不会把附属功能失败升级成保存失败', () => {
  assert.match(editHandler, /moderationStatus: 'PENDING'/)
  assert.match(editHandler, /reviewedAt: null/)
  assert.match(editHandler, /reviewedById: null/)
  assert.match(editHandler, /checkPostForbiddenWords\(\{ title: rawTitle, content: rawContent \}, user\)/)
  assert.match(editHandler, /await createPostModerationHistory\(prisma,/)
  assert.match(editHandler, /await createManyNotifications\(/)
  assert.match(editHandler, /await createAdminActionAudit\(prisma, transactionResult\.audit\)/)
  assert.doesNotMatch(editHandler, /createPostModerationHistory\(tx,/)
  assert.doesNotMatch(editHandler, /createAdminActionAudit\(tx,/)
  assert.match(editHandler, /logPostEditError\(error, postId, user\.id, 'edit-(moderation-history|review-notification|admin-audit)'\)/)
})

test('编辑服务端记录阶段和 Prisma 错误，并返回可识别的业务 HTTP 响应', () => {
  assert.match(route, /console\.error\('\[posts\.update\]'/)
  assert.match(route, /postId,\s*userId,\s*phase/)
  assert.match(route, /prismaCode: knownError \? error\.code : undefined/)
  assert.match(route, /P2022/)
  assert.match(route, /POST_EDIT_SCHEMA_UNAVAILABLE/)
  assert.match(route, /return postEditErrorResponse\(error, postId, guard\.user\.id, phase\)/)
  assert.match(form, /data\?\.message \|\| '保存失败，请稍后重试'/)
  assert.match(form, /router\.replace\(detailHref\)/)
  assert.match(form, /disabled=\{submitting\}/)
})

test('编辑不触发发帖奖励、频率限制或重复创建帖子', () => {
  assert.doesNotMatch(editHandler, /createPost\(/)
  assert.doesNotMatch(editHandler, /registerFee|registrationFee|reward|awardExperience|dailyPostLimit|rateLimit/i)
  assert.match(editHandler, /tx\.post\.update\(/)
  assert.doesNotMatch(editHandler, /tx\.post\.create\(/)
})

test('桌面端遗留操作区为作者/管理员提供编辑入口，且与移动端共用同一权限', () => {
  // 桌面端可见的 .post-detail-legacy-actions 区域在 canEditPost 为真时渲染编辑链接，
  // 与删除按钮同处右侧操作组，风格一致。
  assert.match(detail, /post-detail-legacy-actions/)
  assert.match(detail, /canEditPost \? \([\s\S]*?Link href=\{postEditHref\(post\.id, returnTo\)\}/)
  // 编辑权限统一：作者本人或拥有 post_manage 权限的管理员，不依赖旧管理员字段。
  assert.match(detail, /const canEditPost = Boolean\(user && \(user\.id === post\.User\.id \|\| canManagePost\)\)/)
  assert.match(detail, /const viewerIsAdmin = Boolean\(user && await loadPostAdminPermission\(user, 'post_manage', postId\)\)/)
  assert.match(detail, /const canManagePost = viewerIsAdmin/)
})

test('帖子编辑来源 URL 在广场、编辑页和详情页之间保持不变', () => {
  const source = '/forum?board=chitchat&mode=fish&query=%E5%8F%AA%E5%81%9A%E4%B8%80%E4%BB%B6%E4%BA%8B'
  const detailUrl = new URL(postDetailHref('post-1', source), 'https://ecfc.fans')
  const editUrl = new URL(postEditHref('post-1', source), 'https://ecfc.fans')
  assert.equal(detailUrl.pathname, '/posts/post-1')
  assert.equal(editUrl.pathname, '/posts/post-1/edit')
  assert.equal(detailUrl.searchParams.get('returnTo'), source)
  assert.equal(editUrl.searchParams.get('returnTo'), source)
  assert.equal(new URL(postBackHref(source), 'https://ecfc.fans').searchParams.get('query'), '只做一件事')
  assert.equal(postBackHref(source, 'announcement'), source)
  assert.equal(postBackHref(null, 'announcement'), '/forum?board=announcement')
  assert.equal(postBackHref(null, null), '/forum')
  assert.equal(normalizePostReturnTo('https://evil.example/steal'), null)
  assert.equal(normalizePostReturnTo('/posts/another-post'), null)
})

test('编辑保存使用 replace，详情返回不依赖 router.back，直接 URL 走广场 fallback', () => {
  assert.match(form, /router\.replace\(detailHref\)/)
  assert.doesNotMatch(form, /router\.push\(detailHref\)/)
  assert.match(detailTopbar, /if \(backHref\)[\s\S]*router\.replace\(backHref\)/)
  assert.match(detail, /const detailBackHref = postBackHref\(returnTo, post\.Board\?\.slug\)/)
  assert.match(editPage, /const returnTo = normalizePostReturnTo\(query\.returnTo\)/)
  assert.match(editPage, /detailHref = postDetailHref\(postId, returnTo\)/)
  assert.match(discoveryHome, /router\.push\(postDetailHref\(postId, discoveryReturnTo\)/)
  assert.match(fishPreview, /postDetailHref\(post\.id, returnTo\)/)
})
