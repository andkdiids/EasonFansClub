import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const clientSource = readFileSync(
  new URL('../app/games/undercover-star/UndercoverStarClient.tsx', import.meta.url),
  'utf8',
)
const libSource = readFileSync(new URL('../lib/undercover-star.ts', import.meta.url), 'utf8')
const clientStateSource = readFileSync(
  new URL('../lib/undercover-star-client-state.ts', import.meta.url),
  'utf8',
)
const votesRoute = readFileSync(
  new URL('../app/api/entertainment/undercover-star/matches/[matchId]/votes/route.ts', import.meta.url),
  'utf8',
)
const descriptionsRoute = readFileSync(
  new URL('../app/api/entertainment/undercover-star/matches/[matchId]/descriptions/route.ts', import.meta.url),
  'utf8',
)

// 1) 玩家列表动态布局：等待房间用 .map 渲染真实玩家，不再使用固定 4 格占位
test('等待房间玩家列表使用动态渲染且布局紧凑', () => {
  const roomFn = clientSource.slice(
    clientSource.indexOf('function Room('),
    clientSource.indexOf('function Match('),
  )
  assert.match(roomFn, /room\.players\.map/, '玩家列表必须按 room.players 动态渲染')
  assert.match(roomFn, /space-y-2/, '玩家列表应为竖向紧凑布局')
  assert.doesNotMatch(roomFn, /等待玩家加入/, '不得残留固定占位槽')
})

// 2) 聊天室渲染：等候聊天室与对局发言区均已实现并被挂载
test('等候聊天室与对局发言区均已渲染', () => {
  assert.match(clientSource, /function RoomChat\(/, '等候聊天室组件须存在')
  assert.match(clientSource, /<RoomChat\b/, '等候聊天室须被挂载到房间视图')
  assert.match(clientSource, /function SpeechRoom\(/, '对局发言区组件须存在')
  assert.match(clientSource, /<SpeechRoom\b/, '对局发言区须被挂载到对局视图')
})

// 3) 当前描述不重复：左侧游戏区不得重复渲染 currentRoundDescriptions，仅右侧发言区实时展示
test('当前轮发言只出现在右侧发言区，左侧不重复', () => {
  const matchStart = clientSource.indexOf('function Match(')
  const speechRoomStart = clientSource.indexOf('function SpeechRoom(')
  const matchBody = clientSource.slice(matchStart, speechRoomStart)
  const leftPart = matchBody.slice(0, matchBody.indexOf('<SpeechRoom'))
  assert.doesNotMatch(
    leftPart,
    /currentRoundDescriptions\.map/,
    '左侧游戏区不得重复渲染当前轮发言',
  )
  assert.match(
    clientSource.slice(speechRoomStart),
    /currentRoundDescriptions\.map/,
    '当前轮发言应由右侧发言区实时渲染',
  )
})

// 4) descriptionHistory 过滤：发言区只展示 round < currentRound 的历史
test('发言区历史仅展示早于当前轮的发言', () => {
  const speechRoom = clientSource.slice(
    clientSource.indexOf('function SpeechRoom('),
    clientSource.indexOf('function Finished('),
  )
  assert.match(
    speechRoom,
    /descriptionHistory\.filter\(\(entry\) => entry\.round < snapshot\.round\)/,
    '发言区须按 round < currentRound 过滤历史',
  )
})

// 5) 弃权 payload：前端投票提交支持 abstain:true
test('投票提交支持弃权 payload', () => {
  // onVoteSubmit 在父组件返回体中定义（早于 function Match），故截取文件起始到 Match 之前
  const parentRegion = clientSource.slice(0, clientSource.indexOf('function Match('))
  assert.match(
    parentRegion,
    /onVoteSubmit=\{\(\) => void matchAction\([^]*?abstain: true/,
    '弃权时须发送 abstain:true',
  )
})

// 6) 重复点击只提交一次：提交动作带 busy 锁，提交中拒绝再次进入
test('对局提交带 busy 锁防止重复提交', () => {
  const matchAction = clientSource.slice(
    clientSource.indexOf('async function matchAction('),
    clientSource.indexOf('async function matchAction(') + 400,
  )
  assert.match(matchAction, /if \(busy \|\| !matchId\) return false/, 'matchAction 须在提交中拒绝重入')
})

// 7) 重复提交幂等：后端描述与投票均幂等，弃权写入 targetId:null
test('后端投票/描述提交幂等且支持弃权', () => {
  assert.match(libSource, /if \(existing\) return/, 'submitUndercoverDescription 须幂等（已存在则跳过）')
  assert.match(libSource, /const wantAbstain = input\.abstain === true/, '后端须识别弃权意图')
  assert.match(
    libSource,
    /targetId: null,\s*isAbstain: true/,
    '弃权须写入 targetId:null, isAbstain:true',
  )
})

// 8) broadcast 失败不影响成功：votes / descriptions 路由将广播隔离在 try/catch 中
test('realtime 广播失败不影响 HTTP 成功', () => {
  for (const [name, route] of [['votes', votesRoute], ['descriptions', descriptionsRoute]] as const) {
    assert.match(route, /broadcastMatchState/, `${name} 路由须广播对局状态`)
    assert.match(
      route,
      /try \{[^]*?broadcastMatchState[^]*?\} catch \(broadcastError\)/,
      `${name} 路由须把广播失败隔离，不让已成功的提交变成 500`,
    )
  }
})

// 9) 旧 snapshot 不能覆盖新 revision：低 revision / 低 round 的实时快照被丢弃
test('旧实时快照按 revision/round 丢弃，不覆盖新状态', () => {
  assert.match(
    clientStateSource,
    /if \(next\.revision < current\.revision\) return false/,
    'revision 更旧的快照必须被丢弃',
  )
  assert.match(
    clientStateSource,
    /if \(next\.round < current\.round\) return false/,
    'round 更旧的快照必须被丢弃',
  )
})
