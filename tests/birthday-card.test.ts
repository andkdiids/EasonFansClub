import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const birthdayLib = read('lib/birthday.ts')
const notificationsLib = read('lib/notifications.ts')
const notificationTargetLib = read('lib/notification-target.ts')
const client = read('app/notifications/NotificationsClient.tsx')
const cardPage = read('app/birthday-card/page.tsx')
const cardComponent = read('components/birthday/BirthdayCard.tsx')
const cardImageLib = read('lib/birthday-card-image.ts')
const globals = read('app/globals.css')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20260818000000_add_birthday_card_and_friend/migration.sql')
const profileRoute = read('app/api/users/me/route.ts')
const profilePage = read('app/profile/page.tsx')

test('404 root cause: birthday greeting once linked to a non-existent route, now points to the card page (1: 修复跳转 404)', () => {
  // 曾经的错误：link 写成 /profile/edit（项目无此路由）→ 点击通知 404
  assert.doesNotMatch(birthdayLib, /link:\s*'\/profile\/edit'/, '不应再写入不存在的 /profile/edit')
  assert.doesNotMatch(notificationTargetLib, /\/profile\/edit/, '通知目标解析也不应包含 /profile/edit')
  // 修复后指向生日祝福卡片页
  assert.match(birthdayLib, /link:\s*'\/birthday-card'/)
  // 通知中心点击入口同步改为卡片页
  assert.match(client, /case 'BIRTHDAY_GREETING':[\s\S]*label: '查看生日卡片',[\s\S]*href: '\/birthday-card'/)
})

test('history birthday notifications are repaired without deletion (2: 历史通知兼容)', () => {
  // 迁移把历史错误的 /profile/edit 更新为 /birthday-card，不删除通知
  assert.match(
    migration,
    /UPDATE `Notification` SET `link` = '\/birthday-card' WHERE `type` = 'BIRTHDAY_GREETING' AND `link` = '\/profile\/edit'/,
  )
  assert.doesNotMatch(migration, /DELETE FROM `Notification`/)
})

test('desktop card keeps a 4:3 ratio (3: 桌面端 4:3)', () => {
  assert.match(cardComponent, /birthday-card-frame/)
  // 框架使用单一 4:3 比例，桌面与移动共用同一元素
  assert.match(globals, /\.birthday-card-frame \{[^}]*aspect-ratio:4 \/ 3/)
  // 不得存在把卡片改成其他比例的规则
  assert.doesNotMatch(globals, /\.birthday-card-frame \{[^}]*aspect-ratio:(?!4 \/ 3)/)
})

test('mobile card keeps the same 4:3 ratio (4: 移动端 4:3)', () => {
  // 提取所有 @media 块（按大括号配对），确认移动端没有单独重定义生日卡片的比例
  const mediaBlocks: string[] = []
  const mediaRe = /@media[^{]*\{/g
  let m: RegExpExecArray | null
  while ((m = mediaRe.exec(globals))) {
    const start = globals.indexOf('{', m.index)
    let depth = 0
    for (let j = start; j < globals.length; j += 1) {
      if (globals[j] === '{') depth += 1
      else if (globals[j] === '}') {
        depth -= 1
        if (depth === 0) {
          mediaBlocks.push(globals.slice(start + 1, j))
          break
        }
      }
    }
  }
  for (const block of mediaBlocks) {
    assert.doesNotMatch(block, /\.birthday-card-frame\s*\{/, '移动端不应单独重定义生日卡片比例')
  }
  assert.match(globals, /container-type:inline-size/, '内部元素使用容器查询单位随卡片宽度缩放')
})

test('saved image is a 4:3 picture containing only the card (5: 保存图片 4:3 且无页面元素)', () => {
  assert.match(cardImageLib, /IMAGE_WIDTH = 1200/)
  assert.match(cardImageLib, /IMAGE_HEIGHT = 900/)
  assert.equal(1200 * 3, 900 * 4, '1200x900 即 4:3')
  // 仅用画布绘制卡片内容，不引入任何页面外壳 / 导航
  assert.doesNotMatch(cardImageLib, /from 'next\/navigation'|from 'next\/link'|window\.location/)
  assert.match(cardImageLib, /createElement\('canvas'\)/)
  assert.match(cardImageLib, /私家E院/, '导出图片包含品牌元素')
})

test('privacy: generation is never gated by birthday visibility, and the card only shows the date when public (6: 隐私与权限)', () => {
  // 生成端（本人生日纪念 + 好友提醒）绝不因 birthdayPublic 关闭而跳过（无拦截式 gate）
  assert.doesNotMatch(birthdayLib, /birthdayPublic\s*===\s*(true|false)/)
  assert.doesNotMatch(birthdayLib, /if \([^)]*birthdayPublic[^)]*\)\s*return/)
  // 本人生日纪念仍只在「今天生日」时生成（无生日/非今日 → 不生成错误通知）
  const greetFn = birthdayLib.slice(
    birthdayLib.indexOf('export async function sendBirthdayGreeting'),
    birthdayLib.indexOf('export async function grantTodayBirthdayRewards'),
  )
  assert.match(greetFn, /user\?\.birthMonth == null \|\| user\?\.birthDay == null/)
  assert.match(greetFn, /user\.birthMonth !== month \|\| user\.birthDay !== day/)
  // 好友生日提醒同样不受 birthdayPublic 影响，且点击进入好友主页而非卡片
  assert.match(birthdayLib, /export async function sendFriendBirthdayReminders/)
  assert.match(birthdayLib, /type: 'BIRTHDAY_GREETING'/)
  assert.match(birthdayLib, /link: `\/user\/\${source\.uid}`/)
  // 卡片页根据 birthdayPublic 决定是否展示生日日期
  assert.match(cardPage, /birthdayPublic && fresh\.birthMonth && fresh\.birthDay/)
  // 生日公开开关只在本人的资料接口与卡片页使用，不进入公共模块
  assert.match(profileRoute, /typeof body\?\.birthdayPublic === 'boolean'/)
  assert.match(profilePage, /birthdayPublic: true/)
})

test('notification types and categories are consistent end-to-end (类型与分类一致)', () => {
  const notificationTypeEnum = schema.match(/enum NotificationType\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(notificationTypeEnum, /BIRTHDAY_GREETING/)
  assert.doesNotMatch(notificationTypeEnum, /FRIEND_BIRTHDAY/)
  assert.match(migration, /'FRIEND_BIRTHDAY'/)
  assert.match(notificationsLib, /BIRTHDAY_GREETING: '生日'/)
  assert.match(notificationsLib, /type === 'BIRTHDAY_GREETING' && link\?\.startsWith\(FRIEND_BIRTHDAY_LINK_PREFIX\)\) return 'application'/)
  assert.match(notificationsLib, /type = 'BIRTHDAY_GREETING' AND n\.link LIKE '\/user\/%'/)
  // 好友生日提醒归类到「好友」而非「系统」
  assert.doesNotMatch(notificationsLib, /GUESS_SONG_DUEL_INVITE/)
})
