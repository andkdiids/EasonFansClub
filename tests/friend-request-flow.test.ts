import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  FRIEND_REQUEST_REASON_MAX_LENGTH,
  validateFriendRequestReason,
} from '../lib/friend-request-validation'

const read = (file: string) => readFileSync(file, 'utf8')

const friendDock = read('components/FriendDock.tsx')
const profileCard = read('components/FriendProfileCard.tsx')
const requestActions = read('components/FriendRequestActions.tsx')
const reasonDialog = read('components/FriendRequestReasonDialog.tsx')
const globalCss = read('app/globals.css')
const requestRoute = read('app/api/friends/requests/route.ts')
const friendService = read('lib/friends.ts')
const friendsPage = read('app/friends/page.tsx')
const friendListRoute = read('app/api/friends/list/route.ts')
const receivedRoute = read('app/api/friends/requests/received/route.ts')
const schema = read('prisma/schema.prisma')

test('申请理由服务端/客户端共用 2 至 100 字 trim 校验', () => {
  assert.deepEqual(validateFriendRequestReason(undefined), {
    ok: false,
    code: 'FRIEND_REQUEST_REASON_REQUIRED',
    message: '请输入申请理由',
  })
  assert.equal(validateFriendRequestReason('  ').ok, false)
  const shortReason = validateFriendRequestReason('你')
  assert.equal(shortReason.ok, false)
  if (!shortReason.ok) assert.equal(shortReason.code, 'FRIEND_REQUEST_REASON_TOO_SHORT')
  assert.deepEqual(validateFriendRequestReason('  同担  '), { ok: true, reason: '同担' })
  assert.equal(validateFriendRequestReason('a'.repeat(FRIEND_REQUEST_REASON_MAX_LENGTH)).ok, true)
  const longReason = validateFriendRequestReason('a'.repeat(FRIEND_REQUEST_REASON_MAX_LENGTH + 1))
  assert.equal(longReason.ok, false)
  if (!longReason.ok) assert.equal(longReason.code, 'FRIEND_REQUEST_REASON_TOO_LONG')
})

test('好友搜索的真实用户头像和昵称都打开公共资料卡', () => {
  assert.match(friendDock, /onClick={onProfile}/)
  assert.match(friendDock, /aria-label={`查看\$\{name\}的资料卡`}/)
  assert.match(friendDock, /<FriendProfileCard/)
  assert.doesNotMatch(friendDock, /canOpenProfile = status === 'FRIEND'/)
})

test('资料卡按本人、好友、申请中和非好友状态提供相应操作', () => {
  assert.match(profileCard, /status === 'FRIEND' && showMessage && onMessage/)
  assert.match(profileCard, /status === 'NONE'/)
  assert.match(profileCard, /status === 'OUTGOING_PENDING'/)
  assert.match(profileCard, /status === 'INCOMING_PENDING'/)
  assert.match(profileCard, /查看好友申请/)
  assert.match(profileCard, /查看主页/)
  assert.match(profileCard, /initialStatus="NONE"/)
})

test('资料卡处理收到的申请只调用共享决策组件一次', () => {
  assert.match(profileCard, /<FriendRequestDecision requestId={friend\.requestId}/)
  assert.match(profileCard, /onRelationshipChange\?\.\(action === 'accept' \? 'FRIEND' : 'NONE'\)/)
  assert.doesNotMatch(profileCard, /onRequestDecision/)
  assert.doesNotMatch(friendDock, /onRequestDecision=/)
})

test('点击添加好友只打开统一申请理由弹窗，不直接发送', () => {
  assert.match(requestActions, /<FriendRequestReasonDialog/)
  assert.match(requestActions, /setReasonDialogOpen\(true\)/)
  assert.match(requestActions, /body: JSON\.stringify\(\{ uid, message: reason \}\)/)
  assert.match(reasonDialog, /validateFriendRequestReason\(reason\)/)
  assert.match(reasonDialog, /maxLength={FRIEND_REQUEST_REASON_MAX_LENGTH}/)
})

test('申请理由弹窗通过 body portal 脱离入口 stacking context，并使用独立顶层层级', () => {
  assert.match(reasonDialog, /createPortal\(content, document\.body\)/)
  assert.match(reasonDialog, /className="friend-request-reason-layer"/)
  assert.doesNotMatch(reasonDialog, /z-\[120\]/)
  assert.match(globalCss, /--layer-friend-request-reason:\s*calc\(var\(--layer-friend-profile\) \+ 1\)/)
  assert.match(globalCss, /\.friend-request-reason-layer \{[^}]*position:fixed;[^}]*z-index:var\(--layer-friend-request-reason\);[^}]*isolation:isolate;/)
  assert.match(globalCss, /\.friend-request-reason-dialog \{[^}]*max-height:calc\(100dvh/)
})

test('申请理由 API 缺失、过短或超长时返回明确 400 错误码', () => {
  assert.match(requestRoute, /body\?\.reason \?\? body\?\.message/)
  assert.match(requestRoute, /validateFriendRequestReason/)
  assert.match(requestRoute, /status: 400/)
  assert.match(requestRoute, /reason\.code/)
  assert.match(friendService, /validateFriendRequestReason\(message\)/)
})

test('好友申请持久化使用 FriendRequest.message，并且通知只关联 request key', () => {
  assert.match(friendService, /message: reason\.reason/)
  assert.match(friendService, /key: getFriendRequestNotificationKey\(friendRequest\.id\)/)
  assert.match(friendService, /content: `\$\{currentUser\.nickname\} 向你发送了好友申请`/)
  assert.doesNotMatch(friendService, /content: .*reason/)
})

test('同一方向 pending 申请由现有唯一约束和 409 分支幂等保护，反向申请不重复创建', () => {
  assert.match(schema, /model FriendRequest\s*\{[\s\S]*?@@unique\(\[senderId, receiverId, status\]\)/)
  assert.match(friendService, /status: 'PENDING'/)
  assert.match(friendService, /senderId: currentUser\.id, receiverId: receiver\.id/)
  assert.match(friendService, /senderId: receiver\.id, receiverId: currentUser\.id/)
  assert.match(friendService, /error\.code !== 'P2002'/)
  assert.match(friendService, /status: 409 as const/)
})

test('好友申请发送继续尊重双方拉黑关系，搜索结果批量返回关系状态', () => {
  assert.match(friendService, /prisma\.block\.findFirst/)
  assert.match(friendService, /FRIEND_REQUEST_BLOCKED/)
  for (const status of ['FRIEND', 'OUTGOING_PENDING', 'INCOMING_PENDING', 'NONE', 'SELF', 'BLOCKED']) {
    assert.match(friendListRoute, new RegExp(`'${status}'`))
  }
  assert.match(friendListRoute, /Promise\.all\(\[/)
  assert.doesNotMatch(friendListRoute, /users\.map\(async/)
})

test('好友申请接收方在好友中心显示纯文本理由，并兼容历史 null', () => {
  assert.match(friendsPage, /message: true/)
  assert.match(friendsPage, /message={request\.message}/)
  assert.match(friendsPage, /message\?\.trim\(\)/)
  assert.match(friendsPage, /申请理由/)
  assert.match(friendsPage, /whitespace-pre-wrap break-words/)
  assert.doesNotMatch(friendsPage, /dangerouslySetInnerHTML/)
  assert.match(receivedRoute, /\.\.\.request/)
})

test('好友备注与申请理由保持分离，申请卡不会把 message 写入备注', () => {
  assert.doesNotMatch(profileCard + friendsPage + friendService, /friendRemark.*message|message.*friendRemark/)
  assert.match(friendsPage, /FriendRequestDecision/)
})

test('发送成功后资料卡和搜索结果立即切换为已发送申请，重复提交按钮被禁用', () => {
  assert.match(requestActions, /applyStatus\('PENDING'\)/)
  assert.match(requestActions, /onStatusChange\?\.\(nextStatus\)/)
  assert.match(requestActions, /disabled={status !== 'NONE'}/)
  assert.match(friendDock, /updateFriendRelationship/)
  assert.match(profileCard, /onStatusChange={reportRelationshipChange}/)
})
