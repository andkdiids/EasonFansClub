import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('通知中心只渲染纯文字 actor，不创建空昵称或勋章外壳', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  const renderStart = client.indexOf('function renderNotification')
  const componentReturn = client.indexOf('\n  return (\n    <section', renderStart)
  const displaySection = client.slice(renderStart, componentReturn)

  assert.doesNotMatch(displaySection, /UserDisplayName/)
  assert.doesNotMatch(displaySection, /actorBadge/)
  assert.doesNotMatch(displaySection, /name=""/)
  assert.match(displaySection, /const displayActorName = item\.actorName\?\.trim\(\) \|\| null/)
  assert.match(displaySection, /displayActorName \? <span[^>]*>\{displayActorName\}：<\/span> : null/)
})

test('通知类型和未读状态只在文案有值时渲染胶囊', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  const css = read('app/globals.css')
  assert.match(client, /const displayLabel = \(isBirthday \? '今日' : item\.typeLabel\)\?\.trim\(\) \|\| null/)
  assert.match(client, /const unreadLabel = isNotificationRead\(item\) \? null : '未读'/)
  assert.match(client, /const hasDisplayLabel = Boolean\(displayLabel\?\.trim\(\)\)/)
  assert.match(client, /\{hasDisplayLabel \? <span[^>]*>\{displayLabel\}<\/span> : null\}/)
  assert.match(client, /\{unreadLabel \? <span[^>]*>\{unreadLabel\}<\/span> : null\}/)
  assert.doesNotMatch(css, /\.flat-page \[class\*='bg-sky-50'\]/)
  assert.match(css, /\.flat-page \[class~='bg-sky-50'\]/)
  assert.match(css, /\.flat-page \[class\*='bg-sky-50\/'\]/)
})

test('通知中心隐藏勋章不改变全局 UserDisplayName 默认勋章能力', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  const displayName = read('components/UserDisplayName.tsx')
  const service = read('lib/notifications.ts')

  assert.doesNotMatch(client, /import \{ UserDisplayName \}/)
  assert.match(displayName, /showBadge = true/)
  // 资料卡仍使用 actorProfile.equippedBadge；通知卡片只不再渲染该字段。
  assert.match(service, /equippedBadge: actorBadgeMap\.get\(actor\.id\) \|\| null/)
  assert.match(client, /<FriendProfileCard/)
})

test('通知 actor 名称由服务端按好友备注优先、昵称回退解析', () => {
  const service = read('lib/notifications.ts')
  const remarks = read('lib/friend-remarks.ts')

  assert.match(service, /loadFriendRemarkMap\(userId, actorIds\)/)
  assert.match(service, /getFriendDisplayName\(/)
  assert.match(service, /actorName: actorDisplayName/)
  assert.match(remarks, /getFriendDisplayName/)
  assert.match(read('lib/friend-display-name.ts'), /return isFriendContext && remark \? remark : publicName/)
})

test('通知头像资料卡与正文目标交互仍保留', () => {
  const client = read('app/notifications/NotificationsClient.tsx')

  assert.match(client, /event\.stopPropagation\(\)/)
  assert.match(client, /setSelectedActor\(\{[\s\S]*?friend: actorCardFriend,[\s\S]*?unavailable: item\.actorUnavailable/)
  assert.match(client, /const target = systemNotification \? null : getNotificationTarget\(item\)/)
  assert.match(client, /await navigateToNotification\(item\)/)
})
