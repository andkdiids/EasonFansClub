import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Prisma } from '@prisma/client'
import {
  CHECK_IN_MAKEUP_COST,
  CHECK_IN_MAKEUP_PLAYBACK_SECONDS,
  createChallengeOptions,
  getMakeupEligibility,
  getMakeupWeek,
  getShanghaiMonthKey,
  getShanghaiWeekStart,
  parseChallengeOptions,
  serializePendingChallenge,
} from '../lib/checkin-makeup'

const source = (path: string) => readFileSync(path, 'utf8')
const shanghai = (value: string) => new Date(`${value}+08:00`)

test('1-10 付费补签资格、74 挂号费、流水、余额和周额度均由服务端事务保护', () => {
  assert.equal(CHECK_IN_MAKEUP_COST, 74)
  assert.equal(getMakeupEligibility('2026-08-20', shanghai('2026-08-21T12:00:00')).eligible, true)
  assert.equal(getMakeupEligibility('2026-08-21', shanghai('2026-08-21T12:00:00')).code, 'TODAY_NOT_ALLOWED')
  assert.equal(getMakeupEligibility('2026-08-22', shanghai('2026-08-21T12:00:00')).code, 'FUTURE_NOT_ALLOWED')
  assert.equal(getMakeupEligibility('2026-08-13', shanghai('2026-08-21T12:00:00')).code, 'OUTSIDE_MAKEUP_WINDOW')
  assert.equal(getMakeupWeek('2026-08-20').startKey, '2026-08-17')
  assert.equal(getMakeupWeek('2026-08-23').endKey, '2026-08-24')
  const route = source('app/api/checkin/makeup/paid/route.ts')
  assert.match(route, /TransactionIsolationLevel\.Serializable/)
  assert.match(route, /assertUserMakeupAvailable/)
  assert.match(route, /profile\.points < CHECK_IN_MAKEUP_COST/)
  assert.match(route, /check-in-makeup:\$\{user\.id\}:\$\{targetDateKey\}/)
  const fee = source('lib/registration-fee.ts')
  assert.match(fee, /points: \{ gte: input\.amount \}/)
  assert.match(fee, /points: -input\.amount/)
  assert.match(fee, /REGISTRATION_FEE_INSUFFICIENT/)
})

test('11-14 周一补周日归属上一自然周且不占新周额度', () => {
  const monday = shanghai('2026-08-24T09:00:00')
  const result = getMakeupEligibility('2026-08-23', monday)
  assert.equal(result.eligible, true)
  if (!result.eligible) return
  assert.equal(result.mondaySundayException, true)
  assert.deepEqual(result.week, { startKey: '2026-08-17', endKey: '2026-08-24' })
  assert.equal(getShanghaiWeekStart('2026-08-24'), '2026-08-24')
  assert.equal(getMakeupEligibility('2026-08-22', monday).eligible, false)
})

test('15-20 Challenge 月度唯一、固定题目、10 秒四选一且 PENDING 不泄漏答案', () => {
  assert.equal(CHECK_IN_MAKEUP_PLAYBACK_SECONDS, 10)
  assert.equal(getShanghaiMonthKey(shanghai('2026-09-01T00:01:00')), '2026-09')
  const generated = createChallengeOptions({ correctAnswer: 'A', wrongOption1: 'B', wrongOption2: 'C', wrongOption3: 'D' })
  assert.equal(generated.options.length, 4)
  assert.equal(new Set(generated.options.map((item) => item.id)).size, 4)
  const serialized = serializePendingChallenge({ id: 'challenge', targetDateKey: '2026-08-22', status: 'PENDING', options: generated.options as Prisma.JsonArray, playbackSeconds: 10 })
  assert.deepEqual(Object.keys(serialized).sort(), ['audio', 'challengeId', 'options', 'status', 'targetDate'])
  assert.doesNotMatch(JSON.stringify(serialized), /correctOption|correctAnswer|answerIndex|isCorrect/)
  assert.equal(parseChallengeOptions(generated.options as Prisma.JsonArray).length, 4)
  const schema = source('prisma/schema.prisma')
  assert.match(schema, /@@unique\(\[userId, monthKey\]\)/)
  assert.match(schema, /status\s+MakeupChallengeStatus\s+@default\(PENDING\)/)
  const createRoute = source('app/api/checkin/makeup/challenge/route.ts')
  assert.match(createRoute, /findUnique\(\{ where: \{ userId_monthKey/)
  assert.match(createRoute, /sourceAudioPath/)
})

test('21-32 答对免费、答错只消耗挑战、重复提交不改结果且不自动扣费', () => {
  const answer = source('app/api/checkin/makeup/challenge/[challengeId]/answer/route.ts')
  assert.match(answer, /FOR UPDATE/)
  assert.match(answer, /challenge\.status !== 'PENDING'/)
  assert.match(answer, /status: correct \? 'CORRECT' : 'WRONG'/)
  assert.match(answer, /if \(!correct\) return \{ status: 'WRONG'/)
  assert.match(answer, /type: 'MAKEUP_FREE_QUIZ'/)
  assert.match(answer, /cost: 0/)
  assert.doesNotMatch(answer, /consumeRegistrationFee|CHECK_IN_MAKEUP_COST|pointLog/)
  const dialog = source('components/CheckInMakeupDialog.tsx')
  assert.match(dialog, /使用\{cost\}挂号费补签/)
  assert.match(dialog, /暂不补签/)
  assert.match(dialog, /setConfirmPaid\(true\)/)
  assert.match(dialog, /audio\.currentTime >= challenge\.audio\.durationSeconds/)
})

test('33-38 补签统一重算连续挂号、长期患者幂等，且隔离每日随机/处方奖励', () => {
  const service = source('lib/checkin-makeup.ts')
  assert.match(service, /reconcileCheckInStreakAndLongTermReward/)
  assert.match(service, /businessKey: `checkin-streak:\$\{record\.id\}`/)
  assert.match(service, /action: 'CONTINUOUS_CHECK_IN_BONUS'/)
  assert.match(service, /consecutiveDays: streaks\.currentStreak/)
  assert.doesNotMatch(service, /getRandomCheckInPoints|getRandomCheckInExperience|dailyPrescription|EntertainmentDailyDraw/)
  assert.match(source('prisma/schema.prisma'), /@@unique\(\[action, checkInId\]\)/)
})

test('39-48 管理员历史补签使用 checkin_manage、免费、不占额度并写 AdminActionLog', () => {
  const route = source('app/api/admin/checkin-makeup/route.ts')
  assert.match(route, /requireAdmin\('checkin_manage'\)/)
  assert.match(route, /type: 'MAKEUP_ADMIN'/)
  assert.match(route, /cost: 0/)
  assert.match(route, /CHECK_IN_ADMIN_MAKEUP/)
  assert.match(route, /longTermRewardTriggered/)
  assert.match(route, /if \(!reason\)/)
  assert.match(route, /targetDateKey >= todayKey/)
  assert.match(route, /ALREADY_CHECKED_IN/)
  assert.doesNotMatch(route, /consumeRegistrationFee|pointLog/)
  const service = source('lib/checkin-makeup.ts')
  assert.match(service, /USER_MAKEUP_TYPES[^=]*= \['MAKEUP_FREE_QUIZ', 'MAKEUP_PAID'\]/)
  assert.doesNotMatch(service.match(/USER_MAKEUP_TYPES[^\n]*/)?.[0] || '', /MAKEUP_ADMIN/)
})

test('49-54 migration、唯一约束、串行事务和业务键保证失败回滚及并发幂等', () => {
  const migration = source('prisma/migrations/20260824220000_add_checkin_makeup/migration.sql')
  assert.match(migration, /CheckIn_userId_type_checkinDateKey_idx/)
  assert.match(migration, /MakeupChallenge_userId_monthKey_key/)
  assert.match(migration, /CheckIn_challengeId_key/)
  assert.match(migration, /CHECK_IN_MAKEUP/)
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|UPDATE `User`|INSERT INTO `CheckIn`|INSERT INTO `PointLog`/i)
  const paid = source('app/api/checkin/makeup/paid/route.ts')
  const answer = source('app/api/checkin/makeup/challenge/[challengeId]/answer/route.ts')
  assert.match(paid, /prisma\.\$transaction/)
  assert.match(answer, /prisma\.\$transaction/)
  assert.match(paid + answer, /P2002/)
})
