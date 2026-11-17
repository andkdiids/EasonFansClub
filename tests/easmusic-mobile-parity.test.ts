import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')

test('EasMusic mobile APIs use the existing request auth bridge for user state', () => {
  const requestAuthRoutes = [
    'app/api/music/songs/[songId]/playback/route.ts',
    'app/api/music/songs/[songId]/like/route.ts',
    'app/api/music/albums/[albumId]/like/route.ts',
    'app/api/music/reviews/[reviewId]/interactions/route.ts',
    'app/api/ratings/songs/[songId]/route.ts',
    'app/api/ratings/albums/[albumId]/route.ts',
    'app/api/ratings/me/route.ts',
    'app/api/ratings/reviews/route.ts',
    'app/api/ratings/reviews/[reviewId]/route.ts',
    'app/api/ratings/reviews/[reviewId]/like/route.ts',
    'app/api/ratings/personal-ranking/route.ts',
    'app/api/ratings/personal-ranking/items/route.ts',
    'app/api/ratings/personal-ranking/items/[itemId]/route.ts',
    'app/api/ratings/personal-ranking/order/route.ts',
    'app/api/ratings/personal-ranking/options/route.ts',
    'app/api/music/live/me/route.ts',
    'app/api/music/live/me/concerts/route.ts',
    'app/api/music/live/me/songs/route.ts',
    'app/api/music/live/concerts/[concertId]/attendance/route.ts',
    'app/api/music/concerts/contributions/route.ts',
    'app/api/music/concerts/contributions/[id]/route.ts',
    'app/api/music/live/attendance/[attendanceId]/photos/route.ts',
    'app/api/music/live/attendance/[attendanceId]/photos/[photoId]/route.ts',
  ]
  for (const path of requestAuthRoutes) {
    assert.match(source(path), /(?:requireRequestUser|resolveRequestAuth)\(request\)/, path)
  }
})

test('EasMusic reads expose published metadata and preview capability only where the route supports it', () => {
  const albums = source('app/api/music/albums/route.ts')
  assert.match(albums, /PUBLISHED/)
  assert.doesNotMatch(albums, /sourceAudioPath/)
  assert.doesNotMatch(albums, /hasPreview/)
  for (const path of ['app/api/music/albums/[albumId]/route.ts', 'app/api/music/songs/[songId]/route.ts']) {
    const route = source(path)
    assert.match(route, /PUBLISHED/, path)
    assert.match(route, /hasPreview/, path)
    assert.doesNotMatch(route, /sourceAudioPath/, path)
  }
  const playback = source('app/api/music/songs/[songId]/playback/route.ts')
  assert.match(playback, /previewOnly/)
  assert.match(playback, /resolveRequestAuth\(request\)/)
  assert.match(playback, /Vary: 'Cookie, Authorization'/)
})

test('EasMusic mobile paths and methods are specifically allowlisted', () => {
  const middleware = source('middleware.ts')
  const block = middleware.slice(middleware.indexOf('function isMobileBearerBusinessRequest'), middleware.indexOf('\nfunction isApiPath'))
  for (const path of [
    '/api/music/albums', '/api/music/search', '/api/music/live',
    '/api/music/reviews', '/api/ratings/songs', '/api/ratings/albums',
    '/api/ratings/public-comments', '/api/ratings/personal-ranking',
    '/api/music/concerts/contributions', '/api/music/listening',
  ]) assert.ok(block.includes(path), `missing GET allowlist: ${path}`)
  assert.match(block, /music\\\/songs\\\/\[\^\/\]\+\\\/playback\\\/audio\$\/.test\(pathname\)/, 'missing GET allowlist for protected audio')
  assert.match(block, /music\\\/live\\\/attendance\\\/\[\^\/\]\+\\\/photos\$\/\.test\(pathname\)/, 'missing GET allowlist for live photos')
  const postBlock = block.slice(block.indexOf("if (request.method === 'POST')"), block.indexOf("if (request.method === 'PUT' || request.method === 'PATCH')"))
  const patchBlock = block.slice(block.indexOf("if (request.method === 'PUT' || request.method === 'PATCH')"), block.indexOf("if (request.method === 'DELETE')"))
  const deleteBlock = block.slice(block.indexOf("if (request.method === 'DELETE')"), block.indexOf("if (request.method === 'HEAD')"))
  assert.ok(postBlock.includes("pathname === '/api/music/concerts/contributions'"), 'missing POST allowlist for contributions')
  assert.ok(postBlock.includes("pathname === '/api/music/listening'"), 'missing POST allowlist for listening stats')
  assert.match(postBlock, /live.{0,80}attendance.{0,80}photos/, 'missing POST allowlist for live photos')
  assert.match(patchBlock, /music.{0,80}concerts.{0,80}contributions.{0,80}test\(pathname\)/, 'missing PATCH allowlist for contributions')
  assert.match(patchBlock, /music.{0,80}live.{0,80}attendance.{0,80}photos.{0,80}test\(pathname\)/, 'missing PATCH allowlist for live photos')
  assert.match(deleteBlock, /music.{0,80}concerts.{0,80}contributions.{0,80}test\(pathname\)/, 'missing DELETE allowlist for contributions')
  assert.match(deleteBlock, /music.{0,80}live.{0,80}attendance.{0,80}photos.{0,80}test\(pathname\)/, 'missing DELETE allowlist for live photos')
  const headBlock = block.slice(block.indexOf("if (request.method === 'HEAD')"))
  assert.match(headBlock, /music.{0,80}playback.{0,80}audio.{0,80}test\(pathname\)/, 'missing HEAD allowlist for protected audio')
  assert.match(block, /music.{0,40}\(\?:songs\|albums\).{0,80}like\$\/\.test\(pathname\)/)
  assert.match(block, /ratings.{0,60}reviews.{0,60}like\$\/\.test\(pathname\)/)
  assert.match(block, /music.{0,80}live.{0,80}attendance\$\/\.test\(pathname\)/)
  assert.match(block, /personal-ranking.{0,80}items.{0,80}test\(pathname\)/)
  assert.doesNotMatch(block, /pathname\.startsWith\(['"]\/api\/music\//)
})

test('EasMusic listening stats extend the legacy play record without local media metadata', () => {
  const schema = source('prisma/schema.prisma')
  const playRecord = schema.slice(schema.indexOf('model MusicPlayRecord {'), schema.indexOf('\n}\n\nmodel MusicSong', schema.indexOf('model MusicPlayRecord {')) + 2)
  assert.match(playRecord, /source\s+MusicPlaySource\s+@default\(ONLINE\)/)
  assert.match(playRecord, /eventId\s+String\?/)
  assert.match(playRecord, /startedAt\s+DateTime\?/)
  assert.match(playRecord, /endedAt\s+DateTime\?/)
  assert.match(playRecord, /trackId\s+String\?/)
  assert.match(playRecord, /@@unique\(\[userId, eventId\]/)
  assert.match(schema, /enum MusicPlaySource \{\s+ONLINE\s+LOCAL\s+\}/)

  const migration = source('prisma/migrations/20261117110000_add_music_listening_stats/migration.sql')
  assert.match(migration, /MODIFY `trackId` VARCHAR\(191\) NULL/)
  assert.match(migration, /ADD COLUMN `source` ENUM\('ONLINE', 'LOCAL'\) NOT NULL DEFAULT 'ONLINE'/)
  assert.match(migration, /ADD UNIQUE INDEX `MusicPlayRecord_userId_eventId_key` \(`userId`, `eventId`\)/)
  assert.doesNotMatch(migration, /songId|MusicSong/i)
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i)
  const achievements = source('lib/achievements.ts')
  assert.match(achievements, /MusicPlayRecord:\s*\{\s*where:\s*\{\s*trackId:\s*\{\s*not:\s*null\s*\}\s*\}\s*\}/)
  assert.match(schema, /model Lottery \{[\s\S]*?drawSource\s+String\?\s+@db\.VarChar\(32\)/)
  assert.equal(source('prisma/migrations/20261105090000_add_activity_lottery_draw_source/migration.sql').trim(),
    "ALTER TABLE `Lottery`\n    ADD COLUMN `drawSource` VARCHAR(32) NULL;")

  assert.equal(source('prisma/schema.prisma').match(/enum SocialPostMediaType \{([^}]*)\}/)?.[1]
    ?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(','), 'IMAGE,VIDEO,CAROUSEL,REEL,TEXT')
  assert.equal(source('prisma/migrations/20261102090000_add_social_post_text_media_type/migration.sql').replace(/\r\n/g, '\n').trim(),
    "ALTER TABLE `SocialPost`\nMODIFY `mediaType` ENUM('IMAGE', 'VIDEO', 'CAROUSEL', 'REEL', 'TEXT') NOT NULL;")
  const apiRoutes = [
    'app/api/music/albums/route.ts',
    'app/api/music/albums/[albumId]/route.ts',
    'app/api/music/songs/[songId]/route.ts',
    'app/api/music/songs/[songId]/playback/route.ts',
  ]
  for (const path of apiRoutes.filter((path) => !path.endsWith('/playback/route.ts'))) {
    const route = source(path)
    assert.doesNotMatch(route, /uploadToCos|putObject|downloadToServer/i, path)
    assert.doesNotMatch(route, /sourceAudioPath\s*:/, path)
  }
  const playback = source('app/api/music/songs/[songId]/playback/route.ts')
  const response = playback.slice(playback.indexOf('const response: MusicPlaybackResponse'))
  assert.doesNotMatch(response, /sourceAudioPath/)
  assert.match(playback, /previewOnly/)
})
