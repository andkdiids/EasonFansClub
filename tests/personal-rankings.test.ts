import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PERSONAL_RANKING_LIMITS, assertPersonalRankingHasCapacity, isCompletePersonalRankingOrder, parsePersonalRankingType } from '../lib/personal-ranking'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('个人榜单分别允许最多 27 首单曲和 10 张专辑，数量不是完成度', () => {
  assert.deepEqual(PERSONAL_RANKING_LIMITS, { SONG: 27, ALBUM: 10 })
  assert.equal(parsePersonalRankingType('SONG'), 'SONG')
  assert.equal(parsePersonalRankingType('ALBUM'), 'ALBUM')
  const ui = source('components/ratings/PersonalRankingManager.tsx')
  assert.match(ui, /items\.length} \/ \{limit/)
  assert.doesNotMatch(ui, /完成度|还差.*完成/)
})

test('单曲可从 1 首使用到 27 首、专辑可从 1 张使用到 10 张，下一条被服务端拒绝', () => {
  for (const count of [0, 1, 5, 10, 18, 26]) assert.doesNotThrow(() => assertPersonalRankingHasCapacity('SONG', count))
  assert.doesNotThrow(() => assertPersonalRankingHasCapacity('SONG', 26))
  assert.throws(() => assertPersonalRankingHasCapacity('SONG', 27), /最多收录 27 首/)
  for (const count of [0, 1, 3, 6, 9]) assert.doesNotThrow(() => assertPersonalRankingHasCapacity('ALBUM', count))
  assert.throws(() => assertPersonalRankingHasCapacity('ALBUM', 10), /最多收录 10 张/)
})

test('批量排序只接受当前榜单完整且不重复的 item 集合', () => {
  assert.equal(isCompletePersonalRankingOrder(['A', 'B', 'C'], ['C', 'A', 'B']), true)
  assert.equal(isCompletePersonalRankingOrder(['A', 'B', 'C'], ['A', 'B']), false)
  assert.equal(isCompletePersonalRankingOrder(['A', 'B', 'C'], ['A', 'B', 'B']), false)
  assert.equal(isCompletePersonalRankingOrder(['A', 'B', 'C'], ['A', 'B', 'X']), false)
})

test('schema 使用独立 PersonalRanking 与 PersonalRankingItem，不修改评分模型', () => {
  const schema = source('prisma/schema.prisma')
  assert.match(schema, /model PersonalRanking \{[\s\S]*@@unique\(\[userId, type\]\)/)
  assert.match(schema, /model PersonalRankingItem \{[\s\S]*position\s+Int[\s\S]*note\s+String\?\s+@db\.Text/)
  assert.match(schema, /@@unique\(\[rankingId, songId\]\)[\s\S]*@@unique\(\[rankingId, albumId\]\)/)
  assert.match(schema, /visibility\s+PersonalRankingVisibility\s+@default\(PRIVATE\)/)
  assert.match(schema, /revision\s+Int\s+@default\(0\)/)
  assert.doesNotMatch(schema.match(/model PersonalRankingItem \{[\s\S]*?\n\}/)?.[0] || '', /score|averageRating|publicComments|ratingCount/)
})

test('migration 是纯增量建表且不触碰 Rating 与 RatingStats', () => {
  const migration = source('prisma/migrations/20260824120000_add_personal_rankings/migration.sql')
  assert.match(migration, /CREATE TABLE `PersonalRanking`/)
  assert.match(migration, /CREATE TABLE `PersonalRankingItem`/)
  assert.match(migration, /FOREIGN KEY \(`userId`\).*ON DELETE CASCADE/)
  assert.doesNotMatch(migration, /ALTER TABLE `Rating`|ALTER TABLE `RatingStats`|DROP TABLE|TRUNCATE|DELETE FROM/)
})

test('添加作品由服务端锁榜、校验真实公开作品、限制数量并禁止重复', () => {
  const service = source('lib/personal-ranking.ts')
  assert.match(service, /SELECT id FROM PersonalRanking WHERE id = \$\{rankingId\} FOR UPDATE/)
  assert.match(service, /assertPersonalRankingHasCapacity\(type, count\)/)
  assert.match(service, /LIMIT_REACHED/)
  assert.match(service, /if \(existing\) throw new PersonalRankingError\('DUPLICATE'/)
  assert.match(service, /MusicAlbum: \{ status: 'PUBLISHED' \}/)
  assert.match(service, /status: 'PUBLISHED'/)
})

test('SONG 与 ALBUM 项在服务端只写各自目标字段', () => {
  const service = source('lib/personal-ranking.ts')
  assert.match(service, /type === 'SONG' \? \{ songId: targetId, albumId: null \} : \{ albumId: targetId, songId: null \}/)
})

test('删除中间作品在同一 transaction 内将 position 重排为连续编号', () => {
  const service = source('lib/personal-ranking.ts')
  assert.match(service, /removePersonalRankingItem[\s\S]*personalRankingItem\.delete[\s\S]*orderBy: \[\{ position: 'asc' \}/)
  assert.match(service, /data: \{ position: index \+ 1 \}/)
})

test('排序是完整批量 transaction，可永久反复修改且没有锁榜状态', () => {
  const service = source('lib/personal-ranking.ts')
  const schema = source('prisma/schema.prisma')
  const rankingModels = schema.match(/model PersonalRanking \{[\s\S]*?model MusicTour \{/)?.[0] || ''
  assert.match(service, /reorderPersonalRanking[\s\S]*prisma\.\$transaction/)
  assert.match(service, /isCompletePersonalRankingOrder\(existing\.map/)
  assert.doesNotMatch(`${rankingModels}\n${service}`, /finalized|rankingCompleted|locked\s+Boolean|confirmed\s+Boolean/)
})

test('revision 与客户端合并单请求队列保证最后一次拖动胜出', () => {
  const service = source('lib/personal-ranking.ts')
  const ui = source('components/ratings/PersonalRankingManager.tsx')
  const orderRoute = source('app/api/ratings/personal-ranking/order/route.ts')
  assert.match(service, /current\.revision !== revision[\s\S]*STALE_REVISION/)
  assert.match(service, /FOR UPDATE/)
  assert.match(ui, /orderSavingRef\.current/)
  assert.match(ui, /desiredOrderRef\.current/)
  assert.match(ui, /orderTimerRef\.current = setTimeout\(\(\) => \{[\s\S]*orderTimerRef\.current = null[\s\S]*void flushOrder\(\)[\s\S]*\}, 240\)/)
  assert.match(ui, /if \(!sameOrder\(desiredOrderRef\.current, sentOrder\)\) \{[\s\S]*clearTimeout\(orderTimerRef\.current\)[\s\S]*void flushOrder\(\)/)
  assert.match(orderRoute, /latestRevision: latest\.revision[\s\S]*latest/)
  assert.match(ui, /async function waitForOrderIdle\(\)[\s\S]*orderSavingRef\.current/)
})

test('首次创建榜单遇到唯一键或事务竞争会重试，避免快速连续添加时误报失败', () => {
  const service = source('lib/personal-ranking.ts')
  assert.match(service, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/)
  assert.match(service, /error\.code === 'P2002' \|\| error\.code === 'P2034'/)
  assert.match(service, /personalRanking\.upsert\([\s\S]*userId_type/)
})

test('排序未完成时的添加、删除和感想写入会先等待排序请求收敛', () => {
  const ui = source('components/ratings/PersonalRankingManager.tsx')
  assert.match(ui, /async function addItem[\s\S]*await waitForOrderIdle\(\)/)
  assert.match(ui, /async function removeItem[\s\S]*await waitForOrderIdle\(\)/)
  assert.match(ui, /async function saveNote[\s\S]*await waitForOrderIdle\(\)/)
})

test('榜单所有写接口从会话取用户并校验来源，不接收客户端 userId', () => {
  const routes = [
    'app/api/ratings/personal-ranking/items/route.ts',
    'app/api/ratings/personal-ranking/items/[itemId]/route.ts',
    'app/api/ratings/personal-ranking/order/route.ts',
  ].map(source).join('\n')
  assert.match(routes, /rejectInvalidRequestOrigin/)
  assert.match(routes, /requireUser/)
  assert.doesNotMatch(routes, /body\?\.userId|body\.userId/)
  assert.match(source('lib/personal-ranking.ts'), /item\.ranking\.userId !== userId[\s\S]*FORBIDDEN/)
})

test('我的感想只写 PersonalRankingItem.note 并复用现有违禁词服务', () => {
  const route = source('app/api/ratings/personal-ranking/items/[itemId]/route.ts')
  const service = source('lib/personal-ranking.ts')
  assert.match(route, /sanitizeText\(body\?\.note, 1000\)/)
  assert.match(route, /checkBannedWords\(note\)/)
  assert.match(service, /personalRankingItem\.update\([\s\S]*data: \{ note \}/)
  assert.doesNotMatch(service, /ratingReview\.(create|update).*note|rating\.(create|update).*note/)
})

test('个人榜单批量聚合公开文字评价数量，过滤软删除、空白文本和非活跃用户', () => {
  const service = source('lib/personal-ranking.ts')
  assert.match(service, /getPublicCommentCounts\(type, targetIds\)/)
  assert.match(service, /r\.songId IN \(\$\{Prisma\.join\(targetIds\)\}\)/)
  assert.match(service, /r\.albumId IN \(\$\{Prisma\.join\(targetIds\)\}\)/)
  assert.match(service, /rr\.deletedAt IS NULL AND TRIM\(rr\.content\) <> ''/)
  assert.match(service, /u\.status = \$\{'ACTIVE'\} AND u\.isDeleted = FALSE/)
  assert.doesNotMatch(source('app/api/ratings/personal-ranking/route.ts'), /public-comments/)
})

test('评价数量和正文查询都跟随公开作品状态与相同可见性条件', () => {
  const service = source('lib/personal-ranking.ts')
  assert.match(service, /const targetJoin = target === 'song'/)
  assert.match(service, /AND a\.status = \$\{'PUBLISHED'\}/)
  assert.match(service, /targetJoin[\s\S]*TRIM\(rr\.content\) <> ''[\s\S]*targetJoin[\s\S]*TRIM\(rr\.content\) <> ''/)
})

test('公开评价正文按需分页，直接读取 RatingReview 且安全 DTO 不含 score', () => {
  const service = source('lib/personal-ranking.ts')
  const route = source('app/api/ratings/public-comments/route.ts')
  assert.match(service, /FROM RatingReview rr[\s\S]*INNER JOIN Rating r/)
  assert.match(service, /LIMIT \$\{take\} OFFSET/)
  assert.match(service, /type PublicCommentView = \{[\s\S]*content: string[\s\S]*author:/)
  assert.doesNotMatch(service, /Rating: \{ select: \{ score|score:/)
  assert.match(route, /Cache-Control': 'no-store'/)
})

test('个人榜单 UI 不渲染星级、平均分、评分人数或我的评分', () => {
  const ui = source('components/ratings/PersonalRankingManager.tsx')
  assert.doesNotMatch(ui, /RatingStars|averageScore|ratingCount|人评分|我的评分|★★★★★/)
  assert.match(ui, /item\.publicCommentCount > 0[\s\S]*查看大家的评价 \{item\.publicCommentCount\}/)
  assert.match(ui, /暂无公开评价/)
  assert.match(ui, /comment\.author\.avatarUrl/)
  assert.match(ui, /我的感想/)
})

test('页面保持公开与个人一级、作品类型二级的信息架构', () => {
  const page = source('app/ratings/page.tsx')
  assert.match(page, /歌·颂榜单类型切换/)
  assert.match(page, />公开榜单<\/Link>/)
  assert.match(page, />个人榜单<\/Link>/)
  assert.match(page, /Top 27 单曲/)
  assert.match(page, /Top 10 专辑/)
  assert.match(page, /view === 'public' && user \? <Link href="\/ratings\/me"/)
  assert.match(page, /view === 'public' \? <>[\s\S]*语言分类[\s\S]*rating-search/)
})

test('作品选择器复用公开曲库、支持搜索并禁用已加入与超限操作', () => {
  const service = source('lib/personal-ranking.ts')
  const ui = source('components/ratings/PersonalRankingManager.tsx')
  assert.match(service, /searchPersonalRankingOptions/)
  assert.match(service, /title: \{ contains: query \}/)
  assert.match(service, /name: \{ contains: query \}/)
  assert.match(ui, /option\.added \|\| items\.length >= limit/)
  assert.match(ui, /option\.added \? '已加入' : '\+ 加入榜单'/)
})

test('移动端提供长按拖动、44px 把手、触控滚动隔离和上下移动备用操作', () => {
  const ui = source('components/ratings/PersonalRankingManager.tsx')
  assert.match(ui, /longPressTimerRef/)
  assert.match(ui, /setTimeout\(\(\) => \{[\s\S]*setPointerCapture\(pointerId\)[\s\S]*\}, 260\)/)
  assert.match(ui, /h-11 w-11 touch-none/)
  assert.match(ui, /将\$\{item\.title\}上移/)
  assert.match(ui, /将\$\{item\.title\}下移/)
  assert.match(ui, /max-h-\[calc\(100dvh-16px\)\]/)
  assert.match(ui, /pb-\[env\(safe-area-inset-bottom\)\]/)
})
