import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { matchSnapshot, type MatchRow } from '@/lib/undercover-star'

const root = join(process.cwd())
const service = readFileSync(join(root, 'lib/undercover-star.ts'), 'utf8')
const client = readFileSync(join(root, 'app/games/undercover-star/UndercoverStarClient.tsx'), 'utf8')
const clientState = readFileSync(join(root, 'lib/undercover-star-client-state.ts'), 'utf8')
const realtime = readFileSync(join(root, 'lib/undercover-star-realtime.ts'), 'utf8')
const votesRoute = readFileSync(join(root, 'app/api/entertainment/undercover-star/matches/[matchId]/votes/route.ts'), 'utf8')
const descriptionRoute = readFileSync(join(root, 'app/api/entertainment/undercover-star/matches/[matchId]/descriptions/route.ts'), 'utf8')
const guessRoute = readFileSync(join(root, 'app/api/entertainment/undercover-star/matches/[matchId]/guess/route.ts'), 'utf8')
const startRoute = readFileSync(join(root, 'app/api/entertainment/undercover-star/rooms/[roomId]/start/route.ts'), 'utf8')
const readyRoute = readFileSync(join(root, 'app/api/entertainment/undercover-star/rooms/[roomId]/ready/route.ts'), 'utf8')

// ===========================================================================
// 幂等复核：MatchResult P2002 后不得继续累计 Stats
// ===========================================================================

test('幂等：MatchResult 因 P2002 已存在时，必须跳过该玩家 games/wins/losses/XP 累计', () => {
  // finishMatchTx 的玩家循环内：先写 Result，P2002 仅吞掉，但之后必须立刻
  // 跳过 stats 的 upsert，绝不能“catch P2002 然后继续往下执行”旧写法。
  const start = service.indexOf('for (const player of players) {')
  const end = service.indexOf('return { changed: true', start)
  const block = service.slice(start, end)
  assert.match(block, /await tx\.undercoverMatchResult\.create\(/)
  assert.match(block, /if \(errorCode\(error\) !== 'P2002'\) throw error/)
  const createIdx = block.indexOf('undercoverMatchResult.create(')
  const skipIdx = block.indexOf('if (!createdResult) continue')
  const upsertIdx = block.indexOf('undercoverStats.upsert(')
  assert.ok(createIdx > -1, '应写入 UndercoverMatchResult')
  assert.ok(skipIdx > createIdx, 'P2002 后必须有跳过 stats 的逻辑（if (!createdResult) continue）')
  assert.ok(upsertIdx > skipIdx, 'stats upsert 必须位于 P2002 跳过逻辑之后，绝不先于它执行')
})

// ===========================================================================
// Bug 1：刷新公开房恢复上一局结果
// ===========================================================================

test('Bug1：刷新公开房按钮只刷新列表，不会自动 resume 到上一局（loadLobby(false)）', () => {
  // 刷新按钮必须显式传 false：只 GET 公开 WAITING Room 列表，不跳转 Room/Match/结果页。
  assert.match(client, /onRefresh=\{\(\) => void loadLobby\(false\)\}/)
})

test('Bug1：resolveActiveUndercoverState 对 FINISHED 不标记 isInActiveGame=true', () => {
  // FINISHED 对局可被“查看结果”显式恢复，但绝不能算作 isInActiveGame。
  assert.match(service, /activeMatch: finishedMatch \? \{ matchId: finishedMatch\.id, roomId: finishedMatch\.roomId, status: finishedMatch\.status \} : null,[\s\S]*?isInActiveGame: false,/)
})

test('Bug1：区分“返回当前房间”与“刷新公开房”，不靠 loadLobby 副作用自动跳转', () => {
  // 主动恢复走 resumeActiveGame（基于 activeMatch/activeRoom 的显式按钮），
  // 而非常规 loadLobby 副作用。
  assert.match(client, /function resumeActiveGame\(\) \{/)
  // 初始挂载仍允许 resume（default true），但刷新动作已改为 false（见上一条）。
  assert.match(client, /void loadLobby\(\)/)
  assert.match(client, /void loadLobby\(false\)/)
})

// ===========================================================================
// Bug 2：永远看不到最后一人的描述
// ===========================================================================

function fixtureUser(id: string, name: string) {
  return {
    id,
    uid: id,
    nickname: name,
    username: id,
    usernameModerationStatus: null,
    nicknameModerationStatus: null,
    Profile: { displayName: null, displayNameModerationStatus: null, avatarUrl: null },
    avatarUrl: null,
    UndercoverStats: { level: 1 },
  }
}
function fixturePlayer(id: string, role: 'CIVILIAN' | 'UNDERCOVER', userId: string, name: string) {
  return {
    id,
    role,
    isAlive: true,
    roleConfirmedAt: null,
    lastSeenAt: null,
    eliminatedAt: null,
    User: fixtureUser(userId, name),
  }
}
function fixtureDescription(matchPlayerId: string, content: string, round: number) {
  return { matchPlayerId, content, isAuto: false, round, createdAt: new Date('2026-01-01T00:00:00Z') }
}
function buildMatch(overrides: Record<string, unknown> = {}): MatchRow {
  const base = {
    id: 'm1',
    roomId: 'r1',
    Room: { hostId: 'u1' },
    status: 'VOTING',
    phase: 'VOTING',
    round: 1,
    revision: 5,
    civilianWord: '苹果',
    undercoverWord: '梨',
    currentSpeakerId: null,
    currentSpeakerIndex: null,
    phaseDeadline: null,
    tieCandidateIds: null,
    roundHistory: null,
    finalResult: null,
    UndercoverMatchPlayer: [
      fixturePlayer('p1', 'CIVILIAN', 'u1', 'A'),
      fixturePlayer('p2', 'CIVILIAN', 'u2', 'B'),
      fixturePlayer('p3', 'UNDERCOVER', 'u3', 'C'),
    ],
    UndercoverDescription: [] as ReturnType<typeof fixtureDescription>[],
    UndercoverVote: [] as Array<{ round: number; stage: string; voterId: string; targetId: string | null; isAbstain: boolean }>,
  }
  return { ...base, ...overrides } as unknown as MatchRow
}

test('Bug2：3 人房——最后一人（C）提交后进入 THINKING 的 snapshot 同时包含 A/B/C', () => {
  const match = buildMatch({
    phase: 'THINKING',
    UndercoverDescription: [
      fixtureDescription('p1', '内容A', 1),
      fixtureDescription('p2', '内容B', 1),
      fixtureDescription('p3', '内容C', 1),
    ],
  })
  const snapshot = matchSnapshot(match)
  const round1 = snapshot.descriptions.filter((item) => item.round === 1)
  assert.equal(round1.length, 3, '当前轮必须包含全部 3 条描述')
  assert.ok(round1.some((item) => item.playerId === 'p3' && item.content === '内容C'), '最后一人 C 的描述不得丢失')
})

test('Bug2：4 人房——最后一人（D）提交后进入 THINKING 的 snapshot 同时包含 A/B/C/D', () => {
  const match = buildMatch({
    phase: 'THINKING',
    UndercoverMatchPlayer: [
      fixturePlayer('p1', 'CIVILIAN', 'u1', 'A'),
      fixturePlayer('p2', 'CIVILIAN', 'u2', 'B'),
      fixturePlayer('p3', 'CIVILIAN', 'u3', 'C'),
      fixturePlayer('p4', 'UNDERCOVER', 'u4', 'D'),
    ],
    UndercoverDescription: [
      fixtureDescription('p1', '内容A', 1),
      fixtureDescription('p2', '内容B', 1),
      fixtureDescription('p3', '内容C', 1),
      fixtureDescription('p4', '内容D', 1),
    ],
  })
  const snapshot = matchSnapshot(match)
  const round1 = snapshot.descriptions.filter((item) => item.round === 1)
  assert.equal(round1.length, 4, '当前轮必须包含全部 4 条描述')
  assert.ok(round1.some((item) => item.playerId === 'p4' && item.content === '内容D'), '最后一人 D 的描述不得丢失')
})

test('Bug2：提交描述后回包/广播基于重新查询的 authoritative Match（不丢弃最后一条）', () => {
  // submitUndercoverDescription 在事务结束后返回 getUndercoverMatchState（重新查询）。
  assert.match(service, /return getUndercoverMatchState\(userId, matchId, now\)/)
  // matchSnapshot 序列化全部描述，绝不做 slice(0,-1) 或按 speaker 排除最后一人。
  const snap = service.slice(service.indexOf('export function matchSnapshot'))
  assert.match(snap, /const descriptions: UndercoverDescriptionPublic\[\] = match\.UndercoverDescription\.map\(/)
  assert.doesNotMatch(snap, /descriptions\.slice\(0, -1\)/)
  // 描述 API 在 mutation 成功后广播（同样重新查询），不依赖事务开始时的旧 match 对象。
  assert.match(descriptionRoute, /return undercoverOk\(state\)/)
})

// ===========================================================================
// Bug 3：卧底猜中词后的结算文案错误
// ===========================================================================

test('Bug3：卧底被投出 + 猜对 → UNDERCOVER 获胜（服务端权威 winner/reason）', () => {
  const finalResult = {
    winner: 'UNDERCOVER' as const,
    reason: 'UNDERCOVER_GUESS_CORRECT' as const,
    civilianWord: '苹果',
    undercoverWord: '梨',
    undercoverPlayerId: 'p3',
    players: [],
  }
  const match = buildMatch({ status: 'FINISHED', phase: 'FINISHED', finalResult })
  const snapshot = matchSnapshot(match)
  assert.ok(snapshot.finalResult, 'FINISHED 必须暴露 finalResult')
  assert.equal(snapshot.finalResult!.winner, 'UNDERCOVER')
  assert.equal(snapshot.finalResult!.reason, 'UNDERCOVER_GUESS_CORRECT')
})

test('Bug3：卧底被投出 + 猜错 → CIVILIAN 获胜', () => {
  const finalResult = {
    winner: 'CIVILIAN' as const,
    reason: 'UNDERCOVER_GUESS_WRONG' as const,
    civilianWord: '苹果',
    undercoverWord: '梨',
    undercoverPlayerId: 'p3',
    players: [],
  }
  const match = buildMatch({ status: 'FINISHED', phase: 'FINISHED', finalResult })
  const snapshot = matchSnapshot(match)
  assert.equal(snapshot.finalResult!.winner, 'CIVILIAN')
  assert.equal(snapshot.finalResult!.reason, 'UNDERCOVER_GUESS_WRONG')
})

test('Bug3：结算文案由服务端 authoritative finalResult 决定，不使用 viewer role 拼文案', () => {
  // submitUndercoverGuess：correct → UNDERCOVER / UNDERCOVER_GUESS_CORRECT；否则 CIVILIAN / WRONG。
  assert.match(service, /finishMatchTx\(tx, refreshed, correct \? 'UNDERCOVER' : 'CIVILIAN', correct \? 'UNDERCOVER_GUESS_CORRECT' : 'UNDERCOVER_GUESS_WRONG'/)
  // 客户端 Finished 组件使用 result.winner / result.reason（服务端权威），所有 viewer 一致。
  assert.match(client, /result\.winner === 'UNDERCOVER' \? '卧底胜利' : '平民胜利'/)
  assert.match(client, /result\.reason === 'UNDERCOVER_GUESS_CORRECT' \? '卧底猜中了平民词，成功翻盘。'/)
  // 不得出现按 viewer role 拼接的误导性文案。
  assert.doesNotMatch(client, /我是平民|我被发现了|我是卧底/)
})

// ===========================================================================
// Bug 4：描述时间不同步
// ===========================================================================

test('Bug4：倒计时以服务端 phaseDeadline 为唯一权威（非本地 setSeconds(30)）', () => {
  assert.match(client, /Math\.ceil\(\(new Date\(deadline\)\.getTime\(\) - \(now \+ serverOffset\)\) \/ 1000\)/)
  assert.match(client, /serverNow/)
  // 不得出现“每个客户端从 30 秒本地重新开始”的写法。
  assert.doesNotMatch(client, /setSeconds\(30\)/)
  assert.doesNotMatch(client, /\+ 30 \* 1000|\+ 30000/)
})

test('Bug4：snapshot 暴露 phaseDeadline，客户端据此计算 remaining（reconnect 不重置）', () => {
  assert.match(service, /phaseDeadline: match\.phaseDeadline\?\.toISOString\(\) \|\| null,/)
})

test('Bug4：客户端 revision/matchId guard 丢弃旧 deadline snapshot（reconnect 不覆盖新状态）', () => {
  assert.match(clientState, /if \(current \&\& current\.matchId !== next\.matchId\) return false/)
  assert.match(clientState, /if \(next\.revision < current\.revision\) return false/)
})

test('Bug4：阶段推进由服务端 authoritative 状态机负责（realtime tick 调 advanceExpiredUndercoverMatch）', () => {
  // 客户端本地倒计时归零只触发一次 sync/fetch，绝不能自己决定进入下一阶段。
  assert.match(realtime, /await advanceExpiredUndercoverMatch\(matchId\)/)
})

// ===========================================================================
// Bug 5：投票成功却提示提交失败
// ===========================================================================

test('Bug5：vote 业务 mutation 成功后，broadcast 失败不会变成 HTTP 500（解耦）', () => {
  assert.match(votesRoute, /try \{\s*undercoverRealtimeHub\.broadcastMatchState\(matchId\)/)
  assert.match(votesRoute, /catch \(broadcastError\) \{\s*console\.error\('\[undercover-star\.broadcast\] vote', broadcastError\)/)
  // broadcast 失败后仍返回业务成功。
  assert.match(votesRoute, /return undercoverOk\(state\)/)
})

test('Bug5：description / guess / start / ready 同样将 broadcast 与业务 mutation 解耦', () => {
  for (const [label, route] of [
    ['description', descriptionRoute],
    ['guess', guessRoute],
    ['start', startRoute],
    ['ready', readyRoute],
  ] as const) {
    assert.match(route, /try \{\s*(?:await\s+)?undercoverRealtimeHub\.(broadcastMatchState|broadcastRoom)/, `${label} 路由应将 broadcast 放入独立 try`)
    assert.match(route, /catch \(broadcastError\) \{\s*console\.error\('\[undercover-star\.broadcast\]/, `${label} 路由应吞掉 broadcast 错误`)
  }
})
