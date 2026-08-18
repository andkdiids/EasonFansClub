import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = join(process.cwd())

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

const service = source('lib/undercover-star.ts')
const gameHub = source('lib/undercover-star-realtime.ts')
const chatHub = source('lib/undercover-star-chat-realtime.ts')
const gameClient = source('lib/undercover-star-realtime-client.ts')
const chatClient = source('lib/undercover-star-chat-realtime-client.ts')
const protocol = source('lib/undercover-star-protocol.ts')
const config = source('lib/undercover-star-config.ts')
const clientComponent = source('app/games/undercover-star/UndercoverStarClient.tsx')
const messagesRoute = source('app/api/entertainment/undercover-star/rooms/[roomId]/messages/route.ts')
const server = source('server.ts')
const schema = source('prisma/schema.prisma')
const migration = source('prisma/migrations/20260820000000_undercover_star_two_point_zero/migration.sql')

// ── Phase 4：房间等候聊天室 ──────────────────────────────────────────────
// 说明：与 Phase 3 一致，本套测试以「源码结构校验」为主（项目测试不连真实数据库），
// 验证服务端权限规则、公开结构、realtime 广播、客户端去重/恢复等安全与行为边界。

test('chat 数据模型：复用已有 UndercoverRoomMessage（id/content/createdAt/roomId/userId + 索引）', () => {
  assert.match(schema, /model UndercoverRoomMessage \{[\s\S]*?id\s+String\s+@id @default\(cuid\(\)\)/)
  assert.match(schema, /content\s+String\s+@db\.VarChar\(200\)/)
  assert.match(schema, /createdAt\s+DateTime @default\(now\(\)\)/)
  assert.match(schema, /roomId\s+String/)
  assert.match(schema, /userId\s+String/)
  assert.match(schema, /@@index\(\[roomId, createdAt\]\)/)
  // 2.0 migration 已包含该表，不另建第二套。
  assert.match(migration, /CREATE TABLE UndercoverRoomMessage \(/)
  assert.match(migration, /UndercoverRoomMessage_roomId_createdAt_idx` \(`roomId`, `createdAt`\)/)
})

test('GET / POST messages 路由存在并复用同一路径', () => {
  assert.match(messagesRoute, /export async function GET\(/)
  assert.match(messagesRoute, /export async function POST\(/)
  assert.match(messagesRoute, /getRoomMessages\(guard\.user\.id, roomId, 50\)/)
  assert.match(messagesRoute, /sendRoomMessage\(guard\.user\.id, roomId, content\)/)
  assert.match(messagesRoute, /rejectInvalidRequestOrigin\(request\)/)
  assert.match(messagesRoute, /requireUser\(\)/)
})

test('WAITING 成员可发消息；非成员/被踢/离开玩家不能（ROOM_NOT_MEMBER）', () => {
  assert.match(service, /export async function sendRoomMessage\(userId: string, roomId: string, rawContent: unknown/)
  assert.match(service, /export async function getRoomMessages\(userId: string, roomId: string, limit = 50\)/)
  // 两个入口都先校验成员（leftAt = null 的当前有效成员）。
  assert.match(service, /assertRoomChatMember\(room\)/)
  assert.match(service, /throw new UndercoverStarServiceError\('你不在这个房间中。', 403, 'ROOM_NOT_MEMBER'\)/)
  // 被踢/离开玩家的 leftAt 非空，where: { userId, leftAt: null } 过滤后不再算成员。
  assert.match(service, /UndercoverRoomPlayer: \{ where: \{ userId, leftAt: null \}/)
})

test('PLAYING 或存在进行中对局时禁止聊天（ROOM_CHAT_UNAVAILABLE）', () => {
  assert.match(service, /if \(room\.status !== 'WAITING' \|\| room\.currentMatchId\) \{[\s\S]*?ROOM_CHAT_UNAVAILABLE/)
})

test('空白与超长消息被拒绝（CHAT_EMPTY / CHAT_TOO_LONG，上限 200 字）', () => {
  assert.match(service, /if \(!content\) throw new UndercoverStarServiceError\('消息不能为空。', 400, 'CHAT_EMPTY'\)/)
  assert.match(service, /if \(content\.length > 200\) throw new UndercoverStarServiceError\('消息不能超过 200 字。', 400, 'CHAT_TOO_LONG'\)/)
  // 同时受数据库列长度约束。
  assert.match(schema, /content\s+String\s+@db\.VarChar\(200\)/)
})

test('违禁词复用站内统一审核（content-moderation），不另造第二套', () => {
  assert.match(service, /import \{ containsBannedWord, shouldBypassForbiddenWords \} from '@\/lib\/content-moderation'/)
  assert.match(service, /if \(!shouldBypassForbiddenWords\(user\) && \(await containsBannedWord\(safe\)\)\)/)
  assert.match(service, /throw new UndercoverStarServiceError\('内容包含违禁词[^']*', 400, 'CHAT_CONTAINS_BANNED_WORD'\)/)
})

test('轻量 rate limit：1 秒最多 2 条、10 秒最多 8 条（复用站内设施）', () => {
  assert.match(service, /consumeRateLimit\(userId, 'undercover_chat_fast', 2, 1\)/)
  assert.match(service, /consumeRateLimit\(userId, 'undercover_chat_slow', 8, 10\)/)
  assert.match(service, /ROOM_CHAT_RATE_LIMITED/)
})

test('消息公开结构仅含安全字段，不含 role/word/password 等敏感数据', () => {
  assert.match(service, /function roomMessagePublic\(row: RoomMessageRow\): UndercoverRoomMessagePublic \{/)
  // 公开结构只映射这 7 个字段。
  assert.match(service, /return \{[\s\S]*?id: row\.id,[\s\S]*?roomId: row\.roomId,[\s\S]*?userId: row\.userId,[\s\S]*?name: getPublicUserDisplayName\(row\.User\),[\s\S]*?avatarUrl: profileImageUrl\([\s\S]*?content: row\.content,[\s\S]*?createdAt: row\.createdAt\.toISOString\(\),[\s\S]*?\}/)
  // 仅在该函数体内断言不包含敏感字段（整文件其它位置本就含这些字段名）。
  const block = (service.match(/function roomMessagePublic[\s\S]*?\n\}/) || [''])[0]
  assert.doesNotMatch(block, /role:|word:|passwordHash:/)
})

// ── 聊天室与游戏同步完全隔离（需求第十一） ────────────────────────────────

test('聊天室使用独立 websocket 频道 /ws/undercover-chat，与游戏同步 /ws/undercover 分离', () => {
  assert.match(server, /undercoverChatWebsocketPath = '\/ws\/undercover-chat'/)
  assert.match(server, /undercoverWebsocketPath = '\/ws\/undercover'/)
  // 服务端把聊天频道路由到独立 chat hub，绝不混入游戏 realtime hub 的消息分发。
  assert.match(server, /if \(auth\.channel === 'undercover-chat'\) \{[\s\S]*?undercoverChatHub\.handleMessage\(socket, data\)/)
  assert.match(server, /if \(auth\.channel === 'undercover'\) \{[\s\S]*?undercoverRealtimeHub\.handleMessage\(socket, data\)/)
})

test('游戏 realtime 客户端不再处理聊天消息（聊天走独立 chat 客户端）', () => {
  assert.doesNotMatch(gameClient, /onChatMessage\?:/)
  assert.doesNotMatch(gameClient, /ROOM_CHAT_MESSAGE/)
  assert.match(chatClient, /onChatMessage\?: \(message: UndercoverRoomMessagePublic\) => void/)
  assert.match(chatClient, /if \(event\.type === 'ROOM_CHAT_MESSAGE'\)[\s\S]*?this\.options\.onChatMessage\?\.\(event\.message\)/)
})

test('聊天 hub 独立成类，按 roomId 隔离；游戏 hub 不再承载聊天广播', () => {
  assert.match(chatHub, /export class UndercoverStarChatHub/)
  assert.match(chatHub, /broadcastRoomChat\(roomId: string, message: UndercoverRoomMessagePublic\)/)
  assert.match(chatHub, /const sockets = this\.roomSockets\.get\(roomId\)/)
  assert.match(chatHub, /safeSend\(socket, \{ type: 'ROOM_CHAT_MESSAGE', message \}\)/)
  // 游戏 hub 已移除聊天广播，避免聊天流量影响游戏状态。
  assert.doesNotMatch(gameHub, /broadcastRoomChat/)
})

test('聊天客户端指令为 JOIN_ROOM_CHAT；广播只投送给当前房间在线成员', () => {
  assert.match(protocol, /\| \{ type: 'JOIN_ROOM_CHAT'; roomId: string \}/)
  assert.match(chatClient, /this\.send\(\{ type: 'JOIN_ROOM_CHAT', roomId: this\.options\.roomId \}\)/)
  // 订阅前先校验成员关系（enterUndercoverRoom），非成员无法订阅任何房间聊天。
  assert.match(chatHub, /await enterUndercoverRoom\(userId, roomId\)/)
})

test('broadcast 走独立 chat hub 且失败时 DB 写入成功仍返回成功（best-effort）', () => {
  // POST 路由先 await sendRoomMessage（DB 已落库），再 try/catch 通过 chat hub 广播，最后 undercoverOk。
  assert.match(messagesRoute, /const message = await sendRoomMessage\(guard\.user\.id, roomId, content\)/)
  assert.match(messagesRoute, /try \{[\s\S]*?undercoverChatHub\.broadcastRoomChat\(roomId, message\)[\s\S]*?\} catch \(broadcastError\) \{[\s\S]*?console\.error\('\[undercover-star\.chat\.broadcast\]'/)
  assert.match(messagesRoute, /return undercoverOk\(\{ message \}\)/)
})

test('GET 最近消息最多 50 条，按 createdAt 旧 → 新返回', () => {
  assert.match(service, /take: Math\.min\(Math\.max\(limit, 1\), 100\)/)
  assert.match(messagesRoute, /getRoomMessages\(guard\.user\.id, roomId, 50\)/)
  // 查询最新 N 条（desc）后反转得到旧 → 新。
  assert.match(service, /orderBy: \{ createdAt: 'desc' \}/)
  assert.match(service, /return rows\.reverse\(\)\.map\(roomMessagePublic\)/)
})

test('非成员不能读取聊天历史（getRoomMessages 同样抛 ROOM_NOT_MEMBER）', () => {
  assert.match(service, /export async function getRoomMessages\(userId: string, roomId: string, limit = 50\) \{[\s\S]*?assertRoomChatMember\(room\)/)
  assert.match(messagesRoute, /const messages = await getRoomMessages\(guard\.user\.id, roomId, 50\)/)
})

test('客户端按 message.id 去重，避免 POST 响应与广播重复显示', () => {
  assert.match(clientComponent, /setMessages\(\(prev\) => \(prev\.some\(\(item\) => item\.id === message\.id\) \? prev : \[\.\.\.prev, message\]\)\)/)
})

test('reconnect / 进入 WAITING 房间：HTTP 拉取最近消息恢复聊天室（WS 只负责新消息）', () => {
  // RoomChat 挂载时通过独立 chat 客户端 HTTP 拉取历史；实时新消息由 ROOM_CHAT_MESSAGE 增量追加。
  assert.match(clientComponent, /fetchMessages: async \(id\) => \(await request<\{ messages: UndercoverRoomMessagePublic\[\] \}>\(`\/api\/entertainment\/undercover-star\/rooms\/\$\{id\}\/messages`\)\)\.messages/)
})

test('被踢（ROOM_KICKED）后清理聊天室：房间状态清空使 RoomChat 卸载并清空消息', () => {
  // onKicked 清空 room（回到大厅），RoomChat 因 view!=='ROOM' 卸载，卸载时停止 chat 客户端并清空消息。
  assert.match(clientComponent, /onKicked: \(\) => \{[\s\S]*?setRoom\(null\)[\s\S]*?setView\('LOBBY'\)/)
  assert.match(clientComponent, /return \(\) => \{[\s\S]*?chatClientRef\.current = null[\s\S]*?setMessages\(\[\]\)[\s\S]*?setDraft\(''\)[\s\S]*?setChatError\(''\)[\s\S]*?setNewCount\(0\)\s*\}/)
})

test('房间解散后清理聊天室：CANCELLED 回到大厅使 RoomChat 卸载并清空消息', () => {
  // 房主退出 → Room 关闭为 CANCELLED → onRoom 回到大厅 → RoomChat 卸载清理。
  assert.match(clientComponent, /if \(state\.status === 'CANCELLED'\) \{[\s\S]*?setRoom\(null\)[\s\S]*?setView\('LOBBY'\)/)
  assert.match(protocol, /\| \{ type: 'ROOM_DISSOLVED'; roomId: string \}/)
})

test('游戏开始（PLAYING）关闭聊天室：RoomChat 仅在 WAITING 视图渲染', () => {
  // RoomChat 只在 view==='ROOM' && room 时挂载；开始游戏后 onRoom 设置 matchId 并切换到 MATCH 视图，聊天区域卸载。
  assert.match(clientComponent, /view === 'ROOM' && room \? \([\s\S]*?<RoomChat roomId=\{room\.roomId\}/)
  assert.match(clientComponent, /onStart=\{\(\) => void roomAction\(`\/api\/entertainment\/undercover-star\/rooms\/\$\{room\.roomId\}\/start`\)\}/)
  assert.match(clientComponent, /if \(state\.matchId\) \{[\s\S]*?setView\('MATCH'\)/)
})

test('FINISHED → WAITING 后聊天室重新可用，且旧消息保留在服务器', () => {
  // RoomChat 在 WAITING 视图挂载时重新拉取历史（含上一局前的消息），历史不被清空。
  assert.match(clientComponent, /view === 'ROOM' && room \? \([\s\S]*?<RoomChat /)
  // 服务端 getRoomMessages 不按对局清空，历史随 Room 保留。
  assert.match(service, /where: \{ roomId \}/)
})

// ── 聊天室体验优化：自动滚动 / 新消息提示 / 表情即时发送 ──────────────────

test('底部时新消息自动滚动；查看历史时不强制滚动，并显示「X 条新消息」提示', () => {
  // near-bottom 时跟随滚动。
  assert.match(clientComponent, /useEffect\(\(\) => \{ if \(nearBottomRef\.current\) scrollToBottom\(\) \}, \[messages, scrollToBottom\]\)/)
  // 不在底部时累计新消息数，不滚动。
  assert.match(clientComponent, /if \(!nearBottomRef\.current\) setNewCount\(\(count\) => count \+ 1\)/)
  // 显示「X 条新消息 ↓」并可点击回到底部。
  assert.match(clientComponent, /\{newCount\} 条新消息 ↓/)
  assert.match(clientComponent, /onClick=\{\(\) => \{ scrollToBottom\(\); setNewCount\(0\) \}\}/)
})

test('表情点击即时发送（不进入草稿、不刷新页面、不重新拉取聊天记录）', () => {
  assert.match(clientComponent, /function insertEmoji\(emoji: string\) \{[\s\S]*?void sendMessage\(emoji\)/)
  // 不再把表情拼进草稿。
  assert.doesNotMatch(clientComponent, /function insertEmoji\(emoji: string\) \{[\s\S]*?setDraft\(\(prev\) => \(prev \+ emoji\)/)
})

// ── 房间生命周期：活动时间维护 + 自动清理失效房间 ──────────────────────────

test('WAITING 房间 TTL 为 15 分钟（超过无活动即自动销毁）', () => {
  assert.match(config, /UNDERCOVER_WAITING_TTL_MS = 15 \* 60 \* 1000/)
})

test('心跳（PING）续活 WAITING 房间 lastActivityAt；断开后不再续活', () => {
  // touchUndercoverPresence 在心跳时刷新 WAITING 房间的 lastActivityAt。
  assert.match(service, /export async function touchUndercoverPresence\([\s\S]*?undercoverRoom\.updateMany\(\{ where: \{ id: roomId, status: 'WAITING' \}, data: \{ lastActivityAt: now, updatedAt: now \} \}\)/)
})

test('聊天消息刷新房间 lastActivityAt（活跃聊天中的等候室不被误删）', () => {
  assert.match(service, /const created = await prisma\.undercoverRoomMessage\.create\([\s\S]*?undercoverRoom\.updateMany\(\{ where: \{ id: roomId, status: 'WAITING' \}, data: \{ lastActivityAt: now, updatedAt: now \} \}\)/)
})

test('进入已失效/已销毁房间返回明确提示「房间已失效，请重新创建」', () => {
  // getUndercoverRoomState 对非成员 / 过期 / 不存在的房间统一抛 ROOM_EXPIRED。
  assert.match(service, /throw new UndercoverStarServiceError\('房间已失效，请重新创建。', 410, 'ROOM_EXPIRED'\)/)
  // 大厅 / 房间视图遇到该提示回大厅。
  assert.match(clientComponent, /if \(reason\.includes\('房间已失效'\)\) \{[\s\S]*?setView\('LOBBY'\)/)
})

test('大厅查询前清理过期房间，保证只返回有效房间', () => {
  assert.match(service, /export async function listUndercoverRooms\(\) \{[\s\S]*?await expireWaitingRooms\(\)/)
})
