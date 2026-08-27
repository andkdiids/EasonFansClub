import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('主导航隐藏原生滚动条但保留滚动容器', () => {
  const sidebar = read('components/layout/Sidebar.tsx')
  const css = read('app/globals.css')

  assert.match(sidebar, /className="app-sidebar-scroll"/)
  assert.match(css, /\.app-sidebar-scroll \{[^}]*overflow-y:auto/)
  assert.match(css, /\.app-sidebar-scroll \{[^}]*scrollbar-width:none;[^}]*-ms-overflow-style:none/)
  assert.match(css, /\.app-sidebar-scroll::-webkit-scrollbar \{[^}]*display:none/)
  assert.doesNotMatch(css, /\.app-sidebar-scroll \{[^}]*overflow:hidden/)
})

test('移动端导航中心仍可滚动且不显示滚动条', () => {
  const css = read('app/globals.css')
  assert.match(css, /\.mobile-center-sheet \{[^}]*overflow-y:auto/)
  assert.match(css, /\.mobile-center-sheet \{[^}]*scrollbar-width:none;[^}]*-ms-overflow-style:none/)
  assert.match(css, /\.mobile-center-sheet::-webkit-scrollbar \{[^}]*display:none/)
})

test('共享资料卡通过 body portal 和独立层级脱离页面 stacking context', () => {
  const card = read('components/FriendProfileCard.tsx')
  const css = read('app/globals.css')

  assert.match(card, /createPortal\(content, document\.body\)/)
  assert.match(css, /--layer-friend-profile:\s*100001/)
  assert.match(css, /\.friend-profile-card-layer \{[^}]*position:fixed;[^}]*z-index:var\(--layer-friend-profile\)/)
  assert.match(css, /\.friend-profile-card-layer \{[^}]*inset:0;[^}]*overflow-y:auto/)
})

test('资料卡具备 loading、错误重试、ESC、遮罩关闭和滚动位置恢复', () => {
  const card = read('components/FriendProfileCard.tsx')
  const client = read('app/notifications/NotificationsClient.tsx')

  assert.match(card, /加载用户资料…/)
  assert.match(card, /error \?/)
  assert.match(card, /onRetry \? <button[^>]*>重试<\/button>/)
  assert.match(card, /event\.key !== 'Escape'/)
  assert.match(card, /event\.target === event\.currentTarget/)
  assert.match(card, /window\.scrollTo\(\{ top: scrollY, left: 0, behavior: 'auto' \}\)/)
  assert.match(client, /用户资料加载失败，请重试/)
})

test('通知头像总是打开共享资料卡，资料缺失时使用认证好友查询补齐', () => {
  const client = read('app/notifications/NotificationsClient.tsx')

  assert.match(client, /<FriendProfileCard/)
  assert.match(client, /const needsProfileLoad = !item\.actorProfile && !item\.actorUnavailable/)
  assert.match(client, /loading: needsProfileLoad/)
  assert.match(client, /loadNotificationActorProfile\(item, itemKey\)/)
  assert.match(client, /fetch\(`\/api\/friends\/list\?q=\$\{encodeURIComponent\(String\(item\.actorUid\)\)\}`/)
  assert.match(client, /onRetry=\{\(\) => void loadNotificationActorProfile\(selectedActor\.item, selectedActor\.key\)\}/)
})

test('通知头像阻止冒泡，正文仍保留原跳转行为', () => {
  const client = read('app/notifications/NotificationsClient.tsx')

  assert.match(client, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/)
  assert.match(client, /event\.preventDefault\(\)\n\s+event\.stopPropagation\(\)/)
  assert.match(client, /else if \(target\) void navigateToNotification\(item\)/)
})

test('资料卡主页文案统一为查看主页并保持关系按钮规则', () => {
  const card = read('components/FriendProfileCard.tsx')
  const service = read('lib/notifications.ts')

  assert.match(card, /查看主页/)
  assert.doesNotMatch(card, /进入个人主页/)
  assert.match(card, /status === 'FRIEND' && showMessage && onMessage/)
  assert.match(card, /status === 'NONE'/)
  assert.match(card, /status === 'OUTGOING_PENDING'/)
  assert.match(card, /status === 'INCOMING_PENDING'/)
  assert.match(card, /status === 'SELF'/)
  assert.match(card, /getFriendDisplayName\(\{ nickname: friend\.nickname, friendRemark: friend\.friendRemark/)
  assert.match(service, /status: 'PENDING'/)
  assert.match(service, /relationshipStatus[\s\S]*OUTGOING_PENDING[\s\S]*INCOMING_PENDING/)
  assert.match(service, /requestId: relationshipStatus === 'INCOMING_PENDING'/)
})

test('资料卡五种关系状态使用统一的状态文案和操作入口', () => {
  const card = read('components/FriendProfileCard.tsx')
  const requestActions = read('components/FriendRequestActions.tsx')

  assert.match(card, /status === 'SELF'\n\s+\? '本人'/)
  assert.match(card, /status === 'OUTGOING_PENDING'\n\s+\? '已发送好友申请'/)
  assert.match(card, /status === 'INCOMING_PENDING'\n\s+\? '收到好友申请'/)
  assert.match(card, /buttonClassName="friend-profile-card-action friend-profile-card-action-primary"/)
  assert.match(card, /<FriendRequestDecision requestId=\{friend\.requestId\} layout="inline"/)
  assert.match(requestActions, /layout === 'inline'/)
  assert.match(requestActions, /friend-profile-card-request-error/)
})

test('资料卡在移动端保持紧凑宽度，申请操作不会被一列撑大', () => {
  const css = read('app/globals.css')

  assert.match(css, /\.friend-profile-card \{[^}]*width:min\(380px,calc\(100vw - 40px\)\)/)
  assert.match(css, /\.friend-profile-card \{[^}]*max-width:100%;[^}]*min-width:0/)
  assert.match(css, /\.friend-profile-card-actions \{[^}]*display:flex;[^}]*justify-content:center/)
  assert.match(css, /\.friend-profile-card-actions\.is-three-actions \{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
  assert.doesNotMatch(css, /\.friend-profile-card-actions[^}]*flex:1(?:\s|;)/)
})

test('通知、好友 Dock 和搜索页都只保留查看主页文案', () => {
  const sources = [
    read('components/FriendProfileCard.tsx'),
    read('components/FriendDock.tsx'),
    read('app/notifications/NotificationsClient.tsx'),
    read('app/search/page.tsx'),
  ].join('\n')

  assert.doesNotMatch(sources, /进入个人主页|进入主页|TA的主页/)
  assert.match(sources, /查看主页/)
})
