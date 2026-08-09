import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('EasMusic 首页是完整专辑入口并保留互动展示', () => {
  const home = read('app/music/page.tsx')
  const showcase = read('components/music/MusicAlbumArchiveShowcase.tsx')
  assert.match(home, /where: \{ status: 'PUBLISHED' \}/)
  assert.doesNotMatch(home, /isFeatured: true|FEATURED ALBUMS|精选专辑/)
  assert.match(showcase, /MusicHero/)
  assert.match(showcase, /展开全部专辑/)
  assert.match(showcase, /MusicAlbumCard/)
})

test('EasMusic 三个入口和演唱会时间轴复用现有巡演场次模型', () => {
  const navigation = read('components/music/MusicSectionNavigation.tsx')
  const timeline = read('app/music/concerts/page.tsx')
  const detail = read('app/music/concerts/[concertId]/page.tsx')
  for (const href of ['/music/albums', '/music/concerts', '/music/reviews']) {
    assert.match(navigation, new RegExp(href.replaceAll('/', '\\/')))
  }
  assert.match(timeline, /MusicConcertTimeline/)
  assert.match(timeline, /未完待续/)
  assert.match(detail, /musicTour\.findFirst/)
  assert.match(detail, /MusicConcert/)
  assert.match(detail, /场次与相关资料/)
})

test('专辑鉴赏支持绑定专辑、多图、发布、点赞和收藏且没有评论入口', () => {
  const schema = read('prisma/schema.prisma')
  const admin = read('app/admin/music/reviews/AdminAlbumReviewManager.tsx')
  const detail = read('app/music/reviews/[reviewId]/page.tsx')
  const interaction = read('app/api/music/reviews/[reviewId]/interactions/route.ts')
  for (const model of ['AlbumReview', 'AlbumReviewLike', 'AlbumReviewFavorite']) {
    assert.match(schema, new RegExp(`model ${model} \\{`))
  }
  assert.match(schema, /model AlbumReview \{[\s\S]*images\s+Json[\s\S]*status\s+MusicPublicationStatus[\s\S]*albumId\s+String/)
  assert.match(admin, /ContentImageUploader/)
  assert.match(admin, /PUBLISHED/)
  assert.match(detail, /AlbumReviewActions/)
  assert.match(interaction, /action !== 'like' && action !== 'favorite'/)
  assert.doesNotMatch([admin, detail, interaction].join('\n'), /ReviewComment|\/comments/)
})

test('签到区迁移保留帖子记录并重新统计日常吹水', () => {
  const migrationPath = 'prisma/migrations/20260730120000_add_album_reviews_and_merge_checkin_board/migration.sql'
  assert.equal(existsSync(migrationPath), true)
  const migration = read(migrationPath)
  assert.match(migration, /UPDATE `Post`[\s\S]*SET `boardId` = @daily_chat_board_id/)
  assert.match(migration, /SELECT COUNT\(\*\) FROM `Post`/)
  assert.match(migration, /WHERE `slug` = 'checkin'/)
  assert.doesNotMatch(migration, /DELETE FROM `Post`|TRUNCATE/)
  assert.doesNotMatch(read('lib/boards.ts'), /slug: 'checkin'/)
})
