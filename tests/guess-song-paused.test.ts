import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  GUESS_SONG_MODE_CONFIG,
  GUESS_SONG_PAUSED_RETENTION_MS,
} from '../lib/guess-song-config'

const root = process.cwd()
const source = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

test('PAUSED 是独立的可恢复 session 状态，migration 只扩展 enum', () => {
  const schema = source('prisma/schema.prisma')
  const migration = source('prisma/migrations/20260811090000_add_guess_song_paused_status/migration.sql')
  assert.match(schema, /enum GuessSongSessionStatus[\s\S]*?IN_PROGRESS[\s\S]*?PAUSED[\s\S]*?COMPLETED/)
  assert.match(migration, /MODIFY COLUMN `status` ENUM\('IN_PROGRESS', 'PAUSED', 'COMPLETED', 'ABANDONED', 'EXPIRED', 'CHEAT_DETECTED'\)/)
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DROP COLUMN|DELETE FROM/i)
})

test('暂停存档使用集中配置的 7 天有效期', () => {
  const session = source('lib/guess-song-session.ts')
  assert.equal(GUESS_SONG_PAUSED_RETENTION_MS, 7 * 24 * 60 * 60 * 1000)
  assert.match(source('lib/guess-song-config.ts'), /GUESS_SONG_PAUSED_RETENTION_MS = 7 \* 24 \* 60 \* 60 \* 1000/)
  assert.match(session, /function pausedSessionExpiry\(now: Date\)/)
  assert.match(session, /pausedSessionExpiry\(now\)/)
})

test('pause 只允许 IN_PROGRESS，并且 PAUSED 重复调用幂等', () => {
  const session = source('lib/guess-song-session.ts')
  const pauseBody = session.slice(session.indexOf('export async function pauseGuessSongSession'), session.indexOf('export async function resumeGuessSongSession'))
  assert.match(pauseBody, /status === 'PAUSED'\) return/)
  assert.match(pauseBody, /status !== 'IN_PROGRESS'/)
  assert.match(pauseBody, /status: 'IN_PROGRESS', expiresAt: \{ gt: now \}/)
  assert.match(pauseBody, /data: \{ status: 'PAUSED', expiresAt: pausedSessionExpiry\(now\) \}/)
  assert.doesNotMatch(pauseBody, /score:\s*\{|currentStreak:\s*\{|playCount:\s*\{|livesRemaining:\s*\{/)
})

test('resume 只允许 PAUSED，过期存档转 ABANDONED 而非 EXPIRED', () => {
  const session = source('lib/guess-song-session.ts')
  const resumeBody = session.slice(session.indexOf('export async function resumeGuessSongSession'), session.indexOf('async function getPlayableVariant'))
  const pausedBranch = resumeBody.slice(resumeBody.indexOf("if (session.status === 'PAUSED')"), resumeBody.indexOf("if (session.status === 'IN_PROGRESS')"))
  assert.match(resumeBody, /status === 'PAUSED'/)
  assert.match(resumeBody, /status: 'PAUSED', expiresAt: \{ lte: now \}/)
  assert.match(resumeBody, /data: \{ status: 'ABANDONED', activeKey: null \}/)
  assert.match(resumeBody, /status: 'IN_PROGRESS', expiresAt: sessionExpiry\(session\.mode, now\)/)
  assert.doesNotMatch(pausedBranch, /data: \{ status: 'EXPIRED'/)
})

test('普通 inactivity expiration 只处理 IN_PROGRESS，暂停过期清理不结算排行榜', () => {
  const session = source('lib/guess-song-session.ts')
  assert.match(session, /where: \{ id: sessionId, status: 'IN_PROGRESS', expiresAt: \{ lte: now \} \}/)
  assert.match(session, /status: 'PAUSED', expiresAt: \{ lte: now \}/)
  const pausedCleanup = session.slice(session.indexOf('async function abandonExpiredPausedSessions'), session.indexOf('async function expireGuessSongSession'))
  assert.match(pausedCleanup, /data: \{ status: 'ABANDONED', activeKey: null \}/)
  assert.doesNotMatch(pausedCleanup, /recordGuessSongLeaderboard/)
})

test('大厅会返回暂停存档，且开始新游戏必须显式覆盖指定存档', () => {
  const session = source('lib/guess-song-session.ts')
  const detail = source('components/games/GuessSongDetail.tsx')
  const route = source('app/api/entertainment/guess-song/sessions/route.ts')
  assert.match(session, /pausedSessions/)
  assert.match(session, /status: 'PAUSED', expiresAt: \{ gt: now \}/)
  assert.match(session, /export async function startNewGuessSongSession/)
  assert.match(session, /replacePausedSessionId/)
  assert.match(session, /data: \{ status: 'ABANDONED', activeKey: null \}/)
  assert.match(route, /startNewGuessSongSession/)
  assert.match(route, /replacePausedSessionId/)
  assert.match(detail, /发现未完成的游戏/)
  assert.match(detail, /继续游戏/)
  assert.match(detail, /确认开始新游戏/)
})

test('暂停和恢复 API 使用登录、来源校验、动态 no-store 路由', () => {
  const pause = source('app/api/entertainment/guess-song/sessions/[sessionId]/pause/route.ts')
  const resume = source('app/api/entertainment/guess-song/sessions/[sessionId]/resume/route.ts')
  const api = source('lib/guess-song-api.ts')
  for (const route of [pause, resume]) {
    assert.match(route, /rejectInvalidRequestOrigin/)
    assert.match(route, /requireUser/)
    assert.match(route, /export const dynamic = 'force-dynamic'/)
  }
  assert.match(api, /Cache-Control.*private, no-store/)
})

test('暂停恢复不改变四种模式播放机会、时长和答错机会', () => {
  for (const mode of ['EASY', 'ADVANCED', 'HARD', 'EXPERT'] as const) {
    assert.equal(GUESS_SONG_MODE_CONFIG[mode].maxPlayCount, 5)
    assert.equal(GUESS_SONG_MODE_CONFIG[mode].maxWrongCount, 3)
  }
  assert.equal(GUESS_SONG_MODE_CONFIG.EASY.durationSeconds, 7)
  assert.equal(GUESS_SONG_MODE_CONFIG.ADVANCED.durationSeconds, 5)
  assert.equal(GUESS_SONG_MODE_CONFIG.HARD.durationSeconds, 3)
  assert.equal(GUESS_SONG_MODE_CONFIG.EXPERT.durationSeconds, 7)
  const game = source('app/entertainment/guess-song/GuessSongGame.tsx')
  assert.match(game, /session.status === 'PAUSED'/)
  assert.match(game, /sessions\/\$\{session\.id\}\/pause/)
  assert.match(game, /sessions\/\$\{session\.id\}\/resume/)
  assert.doesNotMatch(game, /visibilitychange[\s\S]*pauseGuessSongSession/)
  assert.doesNotMatch(game, /beforeunload[\s\S]*pauseGuessSongSession/)
})

test('排行榜只接受已完成或当前既有 EXPIRED 结算，PAUSED/ABANDONED 不结算', () => {
  const leaderboard = source('lib/guess-song-leaderboard.ts')
  assert.match(leaderboard, /\['COMPLETED', 'EXPIRED'\]/)
  assert.doesNotMatch(leaderboard, /\['COMPLETED', 'EXPIRED', 'PAUSED'/)
  assert.doesNotMatch(leaderboard, /\['COMPLETED', 'EXPIRED', 'ABANDONED'/)
})
