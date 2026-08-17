import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const service = read('lib/undercover-star.ts')
const friendsRoute = read('app/api/friends/list/route.ts')
const friendDock = read('components/FriendDock.tsx')
const friendTypes = read('lib/friend-types.ts')
const joinRoute = read('app/api/entertainment/undercover-star/rooms/join/route.ts')

test('presence 数据来源为 RoomPlayer / Room / currentMatch，不新增独立表', () => {
  assert.match(service, /export async function getUndercoverPresenceForUsers\(userIds: string\[\]\): Promise<Map<string, UndercoverPresence>>/)
  // 数据来源：有效成员（leftAt=null）且房间处于 WAITING/PLAYING。
  assert.match(service, /undercoverRoomPlayer\.findMany\(\{\s*where: \{[\s\S]*?userId: \{ in: userIds \},[\s\S]*?leftAt: null,[\s\S]*?Room: \{ status: \{ in: \['WAITING', 'PLAYING'\] \} \}/)
  // 不依赖任何 UndercoverPresence 数据库表。
  assert.doesNotMatch(service, /model UndercoverPresence/)
  assert.doesNotMatch(service, /prisma\.undercoverPresence/)
})

test('presence 批量为 N+1 防护：仅 2 次批量查询', () => {
  // 批量查询所有有效成员（一次）。
  assert.match(service, /undercoverRoomPlayer\.findMany\(\{/)
  // 仅对 PLAYING 房间的 currentMatchId 做第二次批量查询，且按 in:[...] 聚合。
  assert.match(service, /undercoverMatch\.findMany\(\{\s*where: \{ id: \{ in: currentMatchIds \} \}/)
  // 不存在逐用户的循环查询（for ... of userIds ... findMany）。
  assert.doesNotMatch(service, /for \(const[\s\S]*?of userIds\)[\s\S]*?\.findMany\(/)
})

test('好友 WAITING Room → presence WAITING', () => {
  // WAITING 分支产出 status: 'WAITING'。
  assert.match(service, /result\.set\(membership\.userId, \{\s*status: 'WAITING',[\s\S]*?roomId: room\.id,[\s\S]*?roomCode: room\.roomCode,[\s\S]*?canJoin,[\s\S]*?requiresPassword,/)
})

test('好友真正 PLAYING → presence PLAYING', () => {
  // PLAYING 分支产出 status: 'PLAYING'、canJoin=false。
  assert.match(service, /result\.set\(membership\.userId, \{\s*status: 'PLAYING',[\s\S]*?roomId: room\.id,[\s\S]*?roomCode: room\.roomCode,[\s\S]*?canJoin: false,[\s\S]*?requiresPassword: false,/)
})

test('没有游戏 → presence null（默认空 Map）', () => {
  assert.match(service, /const result = new Map<string, UndercoverPresence>\(\)[\s\S]*?if \(!userIds\.length\) return result/)
})

test('FINISHED Match + Room WAITING → WAITING presence（不消失）', () => {
  // 因为 FINISHED 后 Room 已被生命周期收敛为 WAITING + currentMatchId=null，
  // 函数对 WAITING 房间一律产出 WAITING presence（分支不依赖 Match 状态）。
  assert.match(service, /if \(room\.currentMatchId\) continue/)
  assert.match(service, /result\.set\(membership\.userId, \{\s*status: 'WAITING',/)
})

test('stale PLAYING Room + FINISHED Match → 不显示 PLAYING', () => {
  // 必须同时满足 currentMatchId 非空且对应 Match.status==='PLAYING'，否则忽略。
  assert.match(service, /if \(!currentMatchId \|\| currentMatchStatus !== 'PLAYING'\) continue/)
})

test('leftAt != null → 无 presence', () => {
  // findMany 的 where 已过滤 leftAt: null。
  assert.match(service, /leftAt: null,[\s\S]*?Room: \{ status: \{ in: \['WAITING', 'PLAYING'\] \}/)
})

test('CANCELLED Room → 无 presence', () => {
  // Room.status 过滤仅含 WAITING/PLAYING，不含 CANCELLED。
  assert.match(service, /status: \{ in: \['WAITING', 'PLAYING'\] \}/)
})

test('WAITING public 未满 → canJoin=true', () => {
  assert.match(service, /const canJoin = aliveCount < UNDERCOVER_MAX_PLAYERS/)
})

test('WAITING 满员 → canJoin=false', () => {
  // canJoin 基于 aliveCount 与上限比较，满员自然为 false。
  assert.match(service, /const canJoin = aliveCount < UNDERCOVER_MAX_PLAYERS/)
})

test('PLAYING → canJoin=false（不允许中途加入）', () => {
  assert.match(service, /status: 'PLAYING',[\s\S]*?canJoin: false,/)
})

test('密码 WAITING → requiresPassword=true', () => {
  assert.match(service, /const requiresPassword = Boolean\(room\.passwordHash\)/)
})

test('presence 不返回 passwordHash', () => {
  // 仅服务端用 Boolean(room.passwordHash) 计算，结果字段为 requiresPassword，不回传原文。
  assert.doesNotMatch(service, /passwordHash: room\.passwordHash|passwordHash: room\?\.passwordHash/)
  assert.match(service, /requiresPassword,/)
})

test('presence 不返回 word / role / Match privateState', () => {
  // 仅检查 presence 函数体，避免误伤 service 文件中其它快照逻辑。
  const start = service.indexOf('export async function getUndercoverPresenceForUsers')
  const fn = service.slice(start, start + 4000)
  assert.doesNotMatch(fn, /\bword:|\brole:|\bprivateState:|\bcivilianWord:|\bundercoverWord:/)
})

test('playin room 列表 API 聚合 presence 到好友', () => {
  assert.match(friendsRoute, /import \{ getUndercoverPresenceForUsers \} from '@\/lib\/undercover-star'/)
  // 一次性批量查询当前可见好友的 presence。
  assert.match(friendsRoute, /getUndercoverPresenceForUsers\(visibleFriendIds\)/)
  // 把 presence 并入每个好友。
  assert.match(friendsRoute, /undercoverPresence: presenceByFriend\.get\(friend\.id\) \|\| null/)
})

test('非好友不能通过好友列表 presence API 查询陌生人', () => {
  // presence 仅对好友列表内的 visibleFriendIds 计算，好友列表本身受 Friendship 关系约束。
  assert.match(friendsRoute, /getUndercoverPresenceForUsers\(visibleFriendIds\)/)
  assert.doesNotMatch(friendsRoute, /getUndercoverPresenceForUsers\(\[[^\]]*[^f]userId[^\]]*\]\)/)
})

test('FriendDockUser 类型含可选 undercoverPresence', () => {
  assert.match(friendTypes, /undercoverPresence\?: UndercoverPresence \| null/)
})

test('FriendDock 跟随进入复用现有 join API（传 roomCode）', () => {
  assert.match(friendDock, /async function followFriendToRoom\(friend: FriendDockUser\)/)
  assert.match(friendDock, /fetch\('\/api\/entertainment\/undercover-star\/rooms\/join'/)
  assert.match(friendDock, /roomCode: presence\.roomCode/)
})

test('密码房必须输入密码，不绕过', () => {
  assert.match(friendDock, /if \(presence\.requiresPassword\) \{[\s\S]*?window\.prompt\(/)
  assert.match(friendDock, /body: JSON\.stringify\(\{ roomCode: presence\.roomCode, password \}\)/)
})

test('PLAYING 不能跟随进入（仅 WAITING + canJoin 才触发）', () => {
  assert.match(friendDock, /if \(!presence \|\| presence\.status !== 'WAITING' \|\| !presence\.canJoin\) return/)
})

test('房满不能进入（canJoin=false 时不发请求）', () => {
  // 同一守卫：!presence.canJoin 直接 return，不发 join 请求。
  assert.match(friendDock, /if \(!presence \|\| presence\.status !== 'WAITING' \|\| !presence\.canJoin\) return/)
})

test('跟随进入成功后被导航到卧底巨星大厅（由 activeRoom 自动恢复房间）', () => {
  assert.match(friendDock, /router\.push\('\/games\/undercover-star'\)/)
})

test('join API 仍是最终权威（服务端再次校验房间状态/密码/人数）', () => {
  // join 路由独立调用 getUndercoverRoomIdByCode + joinUndercoverRoom，不信任 presence 的 canJoin。
  assert.match(joinRoute, /getUndercoverRoomIdByCode\(body\?\.roomCode\)/)
  assert.match(joinRoute, /joinUndercoverRoom\(guard\.user\.id, roomId, \{ password:/)
})

test('FriendRow 展示「卧底巨星 · 房间中 / 游戏中」', () => {
  assert.match(friendDock, /卧底巨星 · 房间中/)
  assert.match(friendDock, /卧底巨星 · 游戏中/)
})

test('FriendRow 展示「跟随进入」与「房间已满」', () => {
  assert.match(friendDock, /跟随进入/)
  assert.match(friendDock, /房间已满/)
})

test('好友退出/被踢/解散后 presence 消失（数据来源 leftAt/status 过滤）', () => {
  // 退出/被踢 → leftAt 非空 → findMany where 过滤排除 → 无 presence。
  assert.match(service, /leftAt: null,[\s\S]*?Room: \{ status: \{ in: \['WAITING', 'PLAYING'\] \}/)
  // 房主解散 → Room.status=CANCELLED → 不在 in:[...] 内 → 无 presence。
  assert.match(service, /status: \{ in: \['WAITING', 'PLAYING'\] \}/)
})

test('Match FINISHED → presence 从 PLAYING 变 WAITING（生命周期收敛）', () => {
  // PLAYING 分支要求 Match.status==='PLAYING'；FINISHED 后该条件失败 → 不清 presence 反而因 Room 收敛为 WAITING 而产出 WAITING。
  assert.match(service, /if \(!currentMatchId \|\| currentMatchStatus !== 'PLAYING'\) continue/)
  assert.match(service, /status: 'WAITING',/)
})
