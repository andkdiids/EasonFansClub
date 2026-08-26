import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const navigation = read('components/layout/navigation.ts')
const mobileNavigation = read('components/layout/MobileNavigation.tsx')
const navigationRegistry = read('lib/navigation-registry.ts')
const rankings = read('app/rankings/page.tsx')
const gameLeaderboardPage = read('app/entertainment/guess-song/leaderboard/page.tsx')
const gameLeaderboardApi = read('app/api/entertainment/guess-song/leaderboard/route.ts')
const trendingPage = read('app/trending/page.tsx')
const trendingQuery = read('lib/trending-posts.ts')
const activities = read('app/activities/page.tsx')
const birthday = read('app/birthday/page.tsx')
const mentionApi = read('app/api/friends/mentions/route.ts')
const replyApi = read('app/api/posts/[postId]/replies/route.ts')
const mentionInput = read('components/FriendMentionInput.tsx')
const mentionText = read('components/MentionText.tsx')
const replyForm = read('components/ReplyForm.tsx')
const schema = read('prisma/schema.prisma')

test('普通排行榜从桌面和移动入口移除并由热门帖子替代', () => {
  assert.doesNotMatch(navigation, /href: '\/rankings'/)
  assert.doesNotMatch(mobileNavigation, /href: '\/rankings'/)
  assert.match(navigationRegistry, /featureKey: 'TRENDING_POSTS'[\s\S]*label: '热门帖子', href: '\/trending'/)
})

test('普通排行榜仅管理员可调试且普通用户重定向到 E院中心', () => {
  assert.match(rankings, /getCurrentUser/)
  assert.match(rankings, /isAdminRole\(user\.role\)/)
  assert.match(rankings, /redirect\('\/community'\)/)
})

test('普通挂号费榜和签到榜没有可公开调用的数据 API', () => {
  assert.equal(existsSync('app/api/rankings'), false)
  assert.equal(existsSync('app/api/leaderboards'), false)
})

test('娱乐天空排行榜页面、API 与成绩写入逻辑保持独立', () => {
  assert.match(gameLeaderboardPage, /GuessSongLeaderboard/)
  assert.match(gameLeaderboardApi, /getGuessSongLeaderboard/)
  assert.doesNotMatch(gameLeaderboardApi, /排行榜暂未开放|redirect\('\/community'\)/)
})

test('热门帖子支持 7 天、30 天、15 条分页和 60 秒短缓存', () => {
  assert.match(trendingPage, /\(\[7, 30\] as const\)/)
  assert.match(trendingPage, /query\.range === '30' \? 30 : 7/)
  assert.match(trendingQuery, /TRENDING_PAGE_SIZE = 15/)
  assert.match(trendingQuery, /revalidate: 60/)
  assert.match(trendingPage, /上一页/)
  assert.match(trendingPage, /下一页/)
})

test('热门查询排除删除、未发布、停用板块和异常作者', () => {
  assert.match(trendingQuery, /p\.status = 'PUBLISHED'/)
  assert.match(trendingQuery, /p\.isDeleted = false/)
  assert.match(trendingQuery, /u\.status = 'ACTIVE'/)
  assert.match(trendingQuery, /u\.isDeleted = false/)
  assert.match(trendingQuery, /b\.isActive = true/)
  assert.match(schema, /Post_trending_window_idx/)
})

test('热门热度公式与稳定排序覆盖浏览、点赞、回复和收藏', () => {
  assert.match(trendingQuery, /viewCount \* 0\.08/)
  assert.match(trendingQuery, /likeCount \* 3/)
  assert.match(trendingQuery, /replyCount \* 5/)
  assert.match(trendingQuery, /favoriteCount \* 4/)
  assert.match(trendingQuery, /hotScore DESC[\s\S]*p\.updatedAt DESC[\s\S]*p\.createdAt DESC/)
})

test('热门卡片只负责跳转并展示摘要、作者、板块、指标和首图', () => {
  assert.match(trendingPage, /href=\{`\/posts\/\$\{post\.id\}`\}/)
  assert.match(trendingPage, /post\.summary/)
  assert.match(trendingPage, /post\.authorName/)
  assert.match(trendingPage, /post\.boardName/)
  assert.match(trendingPage, /post\.imageUrl/)
  assert.doesNotMatch(trendingPage, /LikeButton|FavoriteButton|ReplyForm/)
})

test('活动入口统一命名且 Hero 不再链接生日专题', () => {
  assert.match(navigationRegistry, /featureKey: 'ACTIVITY_CENTER'[\s\S]*label: '活动中心', href: '\/activities'/)
  assert.doesNotMatch(activities, /生日应援专题|href="\/birthday"/)
  assert.match(birthday, /redirect\('\/activities'\)/)
})

test('真实活动只展示已发布数据并可进入详情', () => {
  assert.match(activities, /where: \{ status: 'PUBLISHED' \}/)
  assert.match(activities, /href=\{`\/activities\/\$\{item\.id\}`\}/)
  assert.match(read('app/activities/[activityId]/page.tsx'), /status: 'PUBLISHED'/)
})

test('@ 浮层仅显示好友头像和昵称并支持小型滚动列表', () => {
  assert.match(mentionInput, /\/api\/friends\/mentions/)
  assert.match(mentionInput, /SafeAvatar/)
  assert.match(mentionInput, /friend\.name/)
  assert.match(mentionInput, /max-h-56/)
  assert.doesNotMatch(mentionInput, /UID \{|level|挂号费|手机号|邮箱|在线状态/)
})

test('好友提及搜索以昵称、展示名和 UID 为主并保持精确优先', () => {
  assert.doesNotMatch(mentionApi, /friend\.username/)
  assert.match(mentionApi, /friend\.nickname/)
  assert.match(mentionApi, /friend\.Profile\?\.displayName/)
  assert.match(mentionApi, /normalized\.uid === q \|\| normalized\.rawUid === q \? 1/)
  assert.match(mentionApi, /matchRank - b\.matchRank/)
})

test('默认好友按 90 天提及频次、最近提及和最近互动排序', () => {
  assert.match(mentionApi, /MENTION_HISTORY_DAYS = 90/)
  assert.match(mentionApi, /replyMention\.groupBy/)
  assert.match(mentionApi, /b\.mentionCount - a\.mentionCount/)
  assert.match(mentionApi, /b\.lastMentionAt - a\.lastMentionAt/)
  assert.match(mentionApi, /b\.lastInteractionAt - a\.lastInteractionAt/)
})

test('UID 搜索选择后只插入 @昵称并提交稳定 userId', () => {
  assert.match(mentionInput, /displayText = `@\$\{friend\.name\}`/)
  assert.match(mentionInput, /userId: friend\.id/)
  assert.doesNotMatch(mentionInput, /displayText = `@\$\{friend\.uid\}`/)
  assert.match(replyForm, /JSON\.stringify\(\{[\s\S]*content,[\s\S]*parentId: replyTo\?\.id,[\s\S]*imageUrls,[\s\S]*mentions,[\s\S]*stickerId:/)
})

test('服务端限制五名好友并阻止伪造陌生人、拉黑用户和锁帖提及', () => {
  assert.match(replyApi, /单条内容最多提及 5 位好友/)
  assert.match(replyApi, /friendship\.findMany/)
  assert.match(replyApi, /block\.findMany/)
  assert.match(replyApi, /只能提及当前有效好友/)
  assert.match(replyApi, /isLocked: false/)
  assert.match(replyApi, /Board: \{ isActive: true \}/)
})

test('提及关系和去重通知只在回复事务中写入', () => {
  assert.match(schema, /model ReplyMention/)
  assert.match(schema, /mentionedUserId\s+String/)
  assert.match(replyApi, /tx\.replyMention\.createMany/)
  assert.match(replyApi, /tx\.notification\.createMany/)
  assert.match(replyApi, /skipDuplicates: true/)
  assert.match(replyApi, /reply-mention:\$\{createdReply\.id\}:\$\{mention\.userId\}/)
})

test('提及文本按 userId 关系渲染并链接正确 UID 主页', () => {
  assert.match(mentionText, /mention\.user\.name/)
  assert.match(mentionText, /formatUid\(mention\.user\.uid\)/)
  assert.match(mentionText, /font-semibold text-brand-700/)
})

test('移动输入兼容组合输入、光标插入、点击外部和返回键关闭', () => {
  assert.match(mentionInput, /selectionStart/)
  assert.match(mentionInput, /setSelectionRange/)
  assert.match(mentionInput, /onCompositionStart/)
  assert.match(mentionInput, /onCompositionEnd/)
  assert.match(mentionInput, /document\.addEventListener\('pointerdown'/)
  assert.match(mentionInput, /window\.addEventListener\('popstate'/)
  assert.match(mentionInput, /event\.key === 'Escape'/)
})
