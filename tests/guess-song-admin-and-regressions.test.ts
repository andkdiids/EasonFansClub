import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = process.cwd()
const source = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

test('sticker long-press preview is portaled and does not participate in the grid layout', () => {
  const picker = source('components/StickerPicker.tsx')
  assert.match(picker, /createPortal\(previewLayer, document\.body\)/)
  assert.match(picker, /position:\s*'fixed'/)
  assert.match(picker, /getBoundingClientRect\(\)/)
  assert.match(picker, /setTimeout\(\(\) =>[\s\S]*?500\)/)
  assert.doesNotMatch(picker, /previewing\?\s*\(/)
})

test('feedback notification formats the submission time in Beijing local time', () => {
  const route = source('app/api/feedback/route.ts')
  assert.match(route, /formatBeijingMonthDayTime\(now\)/)
  assert.doesNotMatch(route, /提交时间：\$\{now\.toISOString\(\)\}/)
})

test('guess-song uses a sliding inactivity deadline and settles expired confirmed scores', () => {
  const session = source('lib/guess-song-session.ts')
  const leaderboard = source('lib/guess-song-leaderboard.ts')
  assert.match(session, /expiresAt: sessionExpiry\(playable\.sessionQuestion\.GuessSongSession\.mode, now\)/)
  assert.match(session, /expiresAt: sessionExpiry\(question\.GuessSongSession\.mode, now\)/)
  assert.match(session, /data: \{ status: 'EXPIRED', completedAt: now, activeKey: null \}/)
  assert.match(session, /if \(expired\.count === 1\) await recordGuessSongLeaderboard\(sessionId, tx\)/)
  assert.match(leaderboard, /\['COMPLETED', 'EXPIRED'\]/)
  assert.match(leaderboard, /s\.status IN \('COMPLETED', 'EXPIRED'\)/)
})

test('guess-song leaderboard admin actions are permissioned, rule-based and audited', () => {
  const route = source('app/api/admin/entertainment/guess-song/leaderboard/route.ts')
  const service = source('lib/guess-song-admin-leaderboard.ts')
  const ui = source('app/admin/entertainment/guess-song/GuessSongLeaderboardManager.tsx')
  assert.match(route, /requireAdmin\('entertainment_manage'\)/)
  assert.match(route, /action !== 'ADD_SCORE'/)
  assert.match(service, /calculateGuessSongScore/)
  assert.match(service, /tx\.adminActionLog\.create/)
  assert.match(service, /tx\.\$transaction|prisma\.\$transaction/)
  assert.doesNotMatch(route, /body\?\.score/)
  assert.doesNotMatch(ui, /type="number"/)
  assert.match(ui, /补回答对题数/)
})
