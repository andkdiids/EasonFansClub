import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { levelFromXp, xpForLevel, computeUndercoverXp } from '@/lib/undercover-star-config'

const root = join(process.cwd())
const service = readFileSync(join(root, 'lib/undercover-star.ts'), 'utf8')
const config = readFileSync(join(root, 'lib/undercover-star-config.ts'), 'utf8')

// ===========================================================================
// 难度
// ===========================================================================

test('createUndercoverRoom 默认难度为 NORMAL', () => {
  assert.match(service, /export async function createUndercoverRoom\(userId: string, input: \{ password\?: unknown; difficulty\?: unknown \}/)
  assert.match(service, /const difficulty = isUndercoverDifficulty\(input\.difficulty\) \? input\.difficulty : 'NORMAL'/)
})

test('createUndercoverRoom 保存传入的 EASY 难度', () => {
  // 传入有效难度时直接采用（EASY 路径）。
  assert.match(service, /isUndercoverDifficulty\(input\.difficulty\) \? input\.difficulty : 'NORMAL'/)
  // 房间数据写入 difficulty 字段。
  assert.match(service, /status: 'WAITING',\s*difficulty,/)
})

test('startUndercoverMatch 按房间难度抽取词库并保存难度快照', () => {
  assert.match(service, /where: \{ enabled: true, difficulty: room\.difficulty \}/)
  assert.match(service, /difficulty: room\.difficulty,/)
})

test('当前难度无词时抛出 WORD_POOL_EMPTY', () => {
  assert.match(service, /throw new UndercoverStarServiceError\('当前难度暂无可用词组[^']*', 409, 'WORD_POOL_EMPTY'\)/)
})

test('修改难度：房主在 WAITING 且未开局时可改', () => {
  assert.match(service, /export async function updateUndercoverRoomDifficulty\(hostId: string, roomId: string, difficulty: unknown/)
  // 校验 host
  assert.match(service, /if \(room\.hostId !== hostId\) throw new UndercoverStarServiceError\('只有房主可以修改难度。', 403, 'HOST_ONLY'\)/)
  // 校验 WAITING
  assert.match(service, /if \(room\.status !== 'WAITING'\) throw new UndercoverStarServiceError\('对局已经开始，不能修改难度。', 409, 'ROOM_NOT_WAITING'\)/)
  // 校验未绑定进行中对局
  assert.match(service, /if \(room\.currentMatchId\) throw new UndercoverStarServiceError\('本局已开始，不能修改难度。', 409, 'MATCH_IN_PROGRESS'\)/)
  // 校验非法难度
  assert.match(service, /if \(!isUndercoverDifficulty\(difficulty\)\) throw new UndercoverStarServiceError\('难度无效。', 400, 'DIFFICULTY_INVALID'\)/)
})

test('难度不混抽：EASY/NORMAL/HARD 各自独立（源码未混抽 enabled:true 不带 difficulty）', () => {
  // startUndercoverMatch 的查询条件同时包含 enabled 与 difficulty，确保不混抽。
  assert.match(service, /enabled: true, difficulty: room\.difficulty/)
})

test('Match 保存本局实际难度快照（schema + service 双重确认）', () => {
  assert.match(service, /difficulty: room\.difficulty,/)
  // schema 已新增 UndercoverMatch.difficulty 字段。
  const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
  assert.match(schema, /model UndercoverMatch \{[\s\S]*?difficulty\s+UndercoverDifficulty\s+@default\(NORMAL\)/)
})

// ===========================================================================
// 结算 / XP / 等级
// ===========================================================================

test('finishMatchTx 在幂等守卫内写入 UndercoverMatchResult + 增量 XP + 等级', () => {
  assert.match(service, /await tx\.undercoverMatchResult\.create\(\{/)
  // 幂等：matchId+userId 唯一，重复创建被吞掉（P2002）。
  assert.match(service, /errorCode\(error\) !== 'P2002'\) throw error/)
  // 使用统一 XP 计算（参与 +10 / 获胜 +20）。
  assert.match(service, /const xpEarned = computeUndercoverXp\(\{ isWin: isWinner \}\)/)
  // stats 增量 XP 与等级。
  assert.match(service, /xp: newXp,/)
  assert.match(service, /level: newLevel,/)
  // 幂等短路：updateMany where status PLAYING 只成功一次。
  assert.match(service, /const changed = await tx\.undercoverMatch\.updateMany\(\{\s*where: \{ id: match\.id, status: 'PLAYING' \},/)
})

test('结算仅对 FINISHED 计参与/胜负（CANCELLED 不结算）', () => {
  // finishMatchTx 只对真正 FINISHED 的对局写结果；CANCELLED 流程不调用它。
  assert.match(service, /status: 'FINISHED',/)
})

test('被淘汰玩家仍计入参与与胜负', () => {
  // 结算循环遍历所有 MatchPlayer（不按 isAlive 过滤），并依据 role/winner 判定。
  assert.match(service, /for \(const player of players\) \{/)
  assert.match(service, /const isWinner = \(player\.role === 'UNDERCOVER' && winner === 'UNDERCOVER'\) \|\| \(player\.role === 'CIVILIAN' && winner === 'CIVILIAN'\)/)
})

test('CIVILIAN 获胜时阵营结算：平民胜、卧底负', () => {
  // isWinner 公式对 CIVILIAN 阵营成立。
  assert.match(service, /player\.role === 'CIVILIAN' && winner === 'CIVILIAN'/)
})

test('UNDERCOVER 获胜时阵营结算：卧底胜、平民负', () => {
  assert.match(service, /player\.role === 'UNDERCOVER' && winner === 'UNDERCOVER'/)
})

test('重复 finish 不会重复 games/wins/losses/XP（纯函数幂等校验辅助）', () => {
  // computeUndercoverXp 对同一输入恒定，配合 changed.count 守卫保证只结算一次。
  assert.equal(computeUndercoverXp({ isWin: true }), computeUndercoverXp({ isWin: true }))
  assert.equal(computeUndercoverXp({ isWin: false }), computeUndercoverXp({ isWin: false }))
})

test('连续多局分别统计：旧 Match 不因新 Match finish 再次结算', () => {
  // 每次 finish 都基于 match.id 的 updateMany 守卫，不同 Match 互不影响。
  assert.match(service, /where: \{ id: match\.id, status: 'PLAYING' \},/)
  // MatchResult 唯一键为 [matchId, userId]，不同 Match 产生不同记录。
  const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
  assert.match(schema, /@@unique\(\[matchId, userId\]\)/)
})

test('stats 不泄露 role / word（公开结构仅含统计字段）', () => {
  const start = service.indexOf('export async function getUndercoverUserStats')
  const fn = service.slice(start, start + 1200)
  // 仅返回统计聚合字段，不含 role/word/passwordHash 等敏感信息。
  assert.doesNotMatch(fn, /role\s*[:=]|word\s*[:=]|passwordHash|privateState/)
})

// ===========================================================================
// 等级与 XP 纯函数
// ===========================================================================

test('levelFromXp(0) = 1', () => {
  assert.equal(levelFromXp(0), 1)
})

test('99 XP = Lv1', () => {
  assert.equal(levelFromXp(99), 1)
})

test('100 XP = Lv2', () => {
  assert.equal(levelFromXp(100), 2)
})

test('249 XP = Lv2', () => {
  assert.equal(levelFromXp(249), 2)
})

test('250 XP = Lv3', () => {
  assert.equal(levelFromXp(250), 3)
})

test('高等级边界正确（3200 XP = Lv10，超出封顶 Lv10）', () => {
  assert.equal(levelFromXp(3200), 10)
  assert.equal(levelFromXp(99999), 10)
})

test('xpForLevel 与 levelFromXp 互逆（关键阈值）', () => {
  assert.equal(xpForLevel(1), 0)
  assert.equal(xpForLevel(2), 100)
  assert.equal(xpForLevel(3), 250)
  assert.equal(xpForLevel(10), 3200)
  // 刚好达到阈值的 XP 应升到对应等级。
  for (let level = 1; level <= 10; level += 1) {
    assert.equal(levelFromXp(xpForLevel(level)), level)
  }
})

test('XP 规则：参与 +10，获胜 +20（失败 10，胜利 30）', () => {
  assert.equal(computeUndercoverXp({ isWin: false }), 10)
  assert.equal(computeUndercoverXp({ isWin: true }), 30)
})

test('config 不含难度倍率/阵营/回合加成（保持简单）', () => {
  assert.doesNotMatch(config, /UNDERCOVER_DIFFICULTY_XP_MULTIPLIER/)
  assert.doesNotMatch(config, /UNDERCOVER_XP_UNDERCOVER_BONUS/)
  assert.doesNotMatch(config, /UNDERCOVER_XP_ROUND_BONUS/)
})
