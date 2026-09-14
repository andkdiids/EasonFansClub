import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getProfileRecordPagination, PROFILE_POST_PAGE_SIZE } from '../lib/profile-page'

const read = (path: string) => readFileSync(path, 'utf8')
const actions = read('components/FriendProfileActions.tsx')
const surface = read('components/ProfilePageSurface.tsx')
const modules = read('components/PublicUserModules.tsx')
const profilePage = read('app/user/[uid]/page.tsx')
const moduleRoute = read('app/api/users/[userId]/public-modules/route.ts')
const styles = read('app/globals.css')

test('公开个人主页发帖记录使用每页 5 条并正确计算总页数', () => {
  assert.equal(PROFILE_POST_PAGE_SIZE, 5)
  assert.deepEqual(getProfileRecordPagination(4, 1, PROFILE_POST_PAGE_SIZE), {
    page: 1,
    pageSize: 5,
    total: 4,
    totalPages: 1,
    hasMore: false,
  })
  assert.deepEqual(getProfileRecordPagination(6, 1, PROFILE_POST_PAGE_SIZE), {
    page: 1,
    pageSize: 5,
    total: 6,
    totalPages: 2,
    hasMore: true,
  })
  assert.equal(getProfileRecordPagination(30, 2, PROFILE_POST_PAGE_SIZE).pageSize, 5)
  assert.equal(getProfileRecordPagination(30, 2, PROFILE_POST_PAGE_SIZE).totalPages, 6)
})

test('发帖分页在服务端 count/findMany 共用 where，且只查询当前页', () => {
  assert.match(moduleRoute, /searchParams\.get\('postsPage'\)/)
  assert.match(moduleRoute, /PROFILE_POST_PAGE_SIZE/)
  assert.match(moduleRoute, /const total = await safeDb\('userModules\.posts\.count', prisma\.post\.count\(\{ where: postWhere \}\), 0\)/)
  assert.match(moduleRoute, /prisma\.post\.findMany\(\{[\s\S]*?where: postWhere[\s\S]*?skip: \(pagination\.page - 1\) \* pagination\.pageSize,[\s\S]*?take: pagination\.pageSize/)
  assert.match(moduleRoute, /const pagination = paginationFor\(total, page\)/)
})

test('个人主页使用 postsPage 保留帖子详情返回页码，不重置留言墙状态', () => {
  assert.match(profilePage, /typeof sp\.postsPage === 'string'/)
  assert.match(profilePage, /initialModule=\{initialModule\}/)
  assert.match(modules, /params\.set\('postsPage', String\(modulePages\.posts\)\)/)
  assert.match(modules, /moduleKey === 'posts' \? 'postsPage' : 'page'/)
  assert.match(modules, /router\.replace\(target, \{ scroll: false \}\)/)
  assert.match(modules, /scrollToSectionTop\(modulesSectionRef\.current\)/)
  assert.match(modules, /postDetailHref\(post\.id, postReturnTo\)/)
})

test('其他用户主页顶部把去留言/关注放左侧，删除好友单独放右侧', () => {
  assert.match(actions, /profile-actions-groups[\s\S]*profile-actions-main[\s\S]*去留言[\s\S]*FriendFollowButton/)
  assert.match(actions, /profile-actions-main[\s\S]*profile-actions-danger[\s\S]*删除好友/)
  assert.match(actions, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/)
  assert.match(actions, /aria-controls="profile-wall"/)
  assert.doesNotMatch(surface, /<Link href=\{wallHref\}[^>]*>去留言<\/Link>/)
  assert.match(surface, /id="profile-wall" className="min-w-0 scroll-mt-24"/)
  assert.match(styles, /profile-actions-row > \.profile-actions-groups \{ flex:1 1 auto; min-width:0; \}/)
  assert.match(actions, /messageActionClass = '[^']*whitespace-nowrap/)
  assert.match(actions, /destructiveActionClass = '[^']*whitespace-nowrap/)
})

test('好友删除确认与关注组件仍沿用原有调用链', () => {
  assert.match(actions, /fetch\(`\/api\/friends\/\$\{encodeURIComponent\(targetUserId\)\}`, \{[\s\S]*method: 'DELETE'/)
  assert.match(actions, /<FriendFollowButton[\s\S]*onChanged=\{setIsFollowed\}/)
  assert.match(actions, /<ConfirmDialog[\s\S]*title="确定删除该好友吗？"/)
})
