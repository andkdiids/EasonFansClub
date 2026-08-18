import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// 卧底巨星游戏生命周期 / 旧状态残留回归测试。
// 采用源码结构正则断言（无数据库依赖），锁定「从娱乐天空进入即视为重新进入大厅」
// 且 FINISHED 对局不自动恢复的核心不变量。
const client = readFileSync('app/games/undercover-star/UndercoverStarClient.tsx', 'utf8')

test('进入即重新加载大厅（场景2：从娱乐天空点击进入）', () => {
  // 唯一挂载入口调用 loadLobby()，由服务端返回的房间状态决定视图，而非本地残留。
  assert.match(client, /useEffect\(\(\) => \{ void loadLobby\(\) \}, \[\]\)/)
})

test('房间生命周期校验：仅 PLAYING 自动恢复到对局视图（场景1）', () => {
  // PLAYING 的 activeMatch 才进入 MATCH 视图。
  assert.match(client, /data\.activeMatch && data\.activeMatch\.status === 'PLAYING'[\s\S]*?setView\('MATCH'\)/)
  // WAITING 的 activeRoom 才进入 ROOM 视图。
  assert.match(client, /else if \(data\.activeRoom\) \{[\s\S]*?setView\('ROOM'\)/)
  // 其余（FINISHED / 已退出 / 房间关闭 / 无进行中对局）统一进入 LOBBY。
  assert.match(client, /FINISHED[\s\S]*?不自动恢复上一局/)
  assert.match(client, /\} else \{[\s\S]*?setView\('LOBBY'\)/)
})

test('FINISHED 不再自动恢复到游戏页（根因修复：场景2/3 与测试1/2）', () => {
  // 旧逻辑「只要 activeMatch 存在就进入 MATCH」必须已删除。
  assert.doesNotMatch(client, /if \(resumeActive && data\.activeMatch\) \{[\s\S]*?setView\('MATCH'\)/)
})

test('刷新公开房只列 WAITING 房间，不恢复任何进行中/已结束对局', () => {
  assert.match(client, /onRefresh=\{\(\) => void loadLobby\(false\)\}/)
})

test('FINISHED 仅以大厅「查看结果」入口呈现一次，需用户主动点击', () => {
  const profileCard = readFileSync('components/games/undercover-star/UndercoverProfileCard.tsx', 'utf8')
  // 旧的内联 Banner（在客户端直接渲染结算页入口）已删除，大厅顶部不再常驻提示。
  assert.doesNotMatch(client, /activeMatch\?\.status === 'FINISHED' \? '查看结果' : '继续对局'/)
  // 大厅改为将 activeMatch / activeRoom 与 resume 回调交给「卧底巨星档案」卡片处理。
  assert.match(client, /<UndercoverProfileCard[\s\S]*?activeMatch=\{activeMatch\}[\s\S]*?activeRoom=\{activeRoom\}[\s\S]*?onViewHistory=\{resumeActiveGame\}/)
  // 档案卡片内，FINISHED 仅以「查看结果」入口呈现，需用户主动点击（不自动渲染结算页）。
  assert.match(profileCard, /activeMatch\?\.status === 'FINISHED'/)
  assert.match(profileCard, /上一局已结算/)
  assert.match(profileCard, /查看结果/)
})

test('退出等候室：调用 leave API 并彻底清理客户端状态（场景3 / 测试4/5）', () => {
  assert.match(client, /roomAction\(`\/api\/entertainment\/undercover-star\/rooms\/\$\{roomId\}\/leave`\)/)
  assert.match(client, /realtimeRef\.current\?\.stop\(\); roomRef\.current = null; setRoom\(null\); setActiveRoom\(null\); setActiveMatch\(null\); setRoomId\(null\); setMatchId\(null\); setView\('LOBBY'\)/)
})

test('返回大厅：停止实时连接并清理当前对局状态', () => {
  assert.match(client, /realtimeRef\.current\?\.stop\(\); snapshotRef\.current = null; roomRef\.current = null; setSnapshot\(null\); setPrivateState\(null\); setRoom\(null\); setRoomId\(null\); setMatchId\(null\); setView\('LOBBY'\)/)
})

test('返回大厅对 FINISHED 本局不保留「继续对局」入口（结束页面只展示一次）', () => {
  assert.match(client, /const resumableMatch = matchId && roomId && status === 'PLAYING' \? \{ matchId, roomId, status \} : null/)
})

test('对局结束时停止实时连接与轮询（finish cleanup）', () => {
  assert.match(client, /if \(data\.snapshot\.status === 'FINISHED'\) realtimeRef\.current\?\.stop\(\)/)
})

test('客户端无任何 localStorage / sessionStorage 持久化（key 隔离：不与听听对决等共享）', () => {
  // 状态残留仅来自服务端 activeMatch，而非本地缓存；无通用 key 污染风险。
  assert.doesNotMatch(client, /localStorage|sessionStorage/)
})
