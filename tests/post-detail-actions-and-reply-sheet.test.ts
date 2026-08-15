import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const detail = read('app/posts/[postId]/page.tsx')
const actions = read('components/PostActions.tsx')
const topbar = read('components/ForumDiscoveryDetailTopbar.tsx')
const route = read('app/api/posts/[postId]/route.ts')
const replies = read('components/PostRepliesSection.tsx')
const css = read('app/globals.css')
const uploader = read('components/ContentImageUploader.tsx')
const rewards = read('lib/community-rewards.ts')

test('帖子详情把管理员和作者操作接入移动端菜单，并保留现有权限边界', () => {
  assert.match(detail, /PostManagementMenu/)
  assert.match(detail, /postActions=\{canManagePost \|\| canDeletePost/)
  assert.match(detail, /canManage=\{canManagePost\}/)
  assert.match(detail, /canDelete=\{canDeletePost\}/)
  assert.match(topbar, /postActions\?: ReactNode/)
  assert.match(actions, /method: 'PATCH'/)
  assert.match(actions, /`\/api\/posts\/\$\{postId\}`/)
  assert.match(actions, /confirmDelete/)
  assert.match(actions, /router\.replace\(redirectTo\)/)
})

test('帖子管理 API 只允许 post_manage 置顶和精华，作者只能删除自己的帖子', () => {
  assert.match(route, /const canManagePosts = await hasAdminPermission\(guard\.user, 'post_manage'\)/)
  assert.match(route, /if \(changesModeration && !canManagePosts\)/)
  assert.match(route, /data\.isDeleted && !isOwner && !canManagePosts/)
  assert.match(route, /if \(data\.isFeatured === true && !lockedExisting\.isFeatured\)/)
  assert.match(route, /revalidatePath\('\/forum'\)/)
})

test('重复设为精华不会重复发放同一帖子的奖励', () => {
  assert.match(rewards, /businessKey: `community:featured-post:\$\{input\.postId\}`/)
  assert.match(rewards, /if \(existingReward\) return/)
})

test('移动端回复入口只打开 Bottom Sheet，页面内不保留第二个可见编辑器', () => {
  assert.match(replies, /post-replies-desktop-composer/)
  assert.match(replies, /post-replies-mobile-composer-trigger/)
  assert.match(replies, /setMobileReplySheetOpen\(true\)/)
  assert.match(replies, /function openReplyComposer\(target:/)
  assert.match(replies, /replyTo=\{replyTo\}/)
  assert.match(replies, /post-reply-inline-composer/)
  assert.match(replies, /matchMedia\('\(max-width: 767px\)'\)/)
  assert.match(css, /post-replies-desktop-composer \{ display:none; \}/)
  assert.match(css, /post-reply-inline-composer \{ display:none; \}/)
  assert.match(css, /post-replies-mobile-composer-trigger \{ display:block; \}/)
})

test('回复 Bottom Sheet、文本框和图片上传器限制在父容器内并适配安全区', () => {
  assert.match(css, /\.post-reply-bottom-sheet \{ max-width:100vw; overflow-x:hidden; \}/)
  assert.match(css, /post-reply-bottom-sheet[\s\S]*post-reply-form textarea:focus[\s\S]*box-shadow:inset 0 0 0 2px var\(--primary\)/)
  assert.match(css, /post-content-image-uploader-trigger \{ width:100%; max-width:100%; min-width:0; box-sizing:border-box; \}/)
  assert.match(css, /padding-bottom:max\(16px,env\(safe-area-inset-bottom,0px\)\)/)
  assert.match(uploader, /post-content-image-uploader-trigger flex w-full min-w-0 max-w-full/)
  assert.doesNotMatch(css, /\.post-reply-bottom-sheet[^}]*?(?<!max-)width:100vw;/)
})
