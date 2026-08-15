import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  formatAverageScore,
  normalizeRatingLanguage,
  parseRatingScore,
  scoreToStars,
} from '../lib/rating-types'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('歌·颂评分只接受 1 到 10 的整数，并按半星换算', () => {
  assert.equal(parseRatingScore(1), 1)
  assert.equal(parseRatingScore('10'), 10)
  assert.equal(parseRatingScore(0), null)
  assert.equal(parseRatingScore(11), null)
  assert.equal(parseRatingScore(7.5), null)
  assert.equal(scoreToStars(7), 3.5)
})

test('歌·颂语言映射统一为粤语、国语和外语', () => {
  assert.equal(normalizeRatingLanguage('Cantonese'), 'CANTONESE')
  assert.equal(normalizeRatingLanguage('zh-HK'), 'CANTONESE')
  assert.equal(normalizeRatingLanguage('国语'), 'MANDARIN')
  assert.equal(normalizeRatingLanguage('zh-CN'), 'MANDARIN')
  assert.equal(normalizeRatingLanguage('Japanese'), 'FOREIGN')
  assert.equal(normalizeRatingLanguage('English'), 'FOREIGN')
})

test('平均分保留一位小数但不截断核心计算', () => {
  assert.equal(formatAverageScore(9.7231), '9.7')
  assert.equal(formatAverageScore(10), '10.0')
})

test('schema 将 Rating、Review、点赞和聚合分开，并用数据库唯一约束防重复', () => {
  const schema = source('prisma/schema.prisma')
  assert.match(schema, /model Rating \{[\s\S]*@@unique\(\[userId, songId\]\)[\s\S]*@@unique\(\[userId, albumId\]\)/)
  assert.match(schema, /model RatingReview \{[\s\S]*ratingId\s+String[\s\S]*activeKey\s+String\?\s+@unique[\s\S]*deletedAt\s+DateTime\?/)
  assert.match(schema, /model RatingReviewLike \{[\s\S]*@@unique\(\[reviewId, userId\]\)/)
  assert.match(schema, /model RatingStats \{[\s\S]*ratingCount[\s\S]*ratingScoreTotal[\s\S]*averageScore[\s\S]*reviewCount/)
  assert.match(schema, /RatingReview\s+RatingReview\[\][\s\S]*onDelete: Restrict/)
})

test('评分服务使用完整公开曲库、数据库排序分页，并且不读取试听字段', () => {
  const service = source('lib/rating-service.ts')
  assert.match(service, /FROM MusicSong AS s[\s\S]*INNER JOIN MusicAlbum AS a ON a\.id = s\.albumId/)
  assert.match(service, /a\.status = \$\{'PUBLISHED'\}/)
  assert.match(service, /ORDER BY COALESCE\(rs\.averageScore, 0\) DESC, COALESCE\(rs\.ratingCount, 0\) DESC, s\.id ASC/)
  assert.match(service, /LIMIT \$\{safePageSize\} OFFSET \$\{skip\}/)
  assert.doesNotMatch(service, /previewUrl|sourceAudioPath|MusicPlayer|resolveMusicPlayback/)
})

test('评分 transaction 同步维护统计，删除评论只减少 reviewCount', () => {
  const service = source('lib/rating-service.ts')
  assert.match(service, /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*tx\.rating\.create/)
  assert.match(service, /ratingCount: 1, ratingScoreTotal: score, reviewCount: review \? 1 : 0/)
  assert.match(service, /deleteRatingReview[\s\S]*reviewCount: -1/)
  assert.doesNotMatch(service, /ratingCount: -1|ratingScoreTotal: -score/)
})

test('公开 API 复用登录、来源校验和违禁词体系，后台使用歌·颂权限', () => {
  const song = source('app/api/ratings/songs/[songId]/route.ts')
  const review = source('app/api/ratings/reviews/route.ts')
  const admin = source('app/api/admin/ratings/reviews/route.ts')
  assert.match(song, /rejectInvalidRequestOrigin/)
  assert.match(song, /requireUser/)
  assert.match(review, /checkBannedWords/)
  assert.match(admin, /requireAdmin\('rating_manage'\)/)
})
