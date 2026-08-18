import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

// 说明：本套测试以「源码结构校验」为主（项目测试不连真实数据库），
// 验证 username / nickname 定位重构后的关键边界：
//   - 登录入口仅手机号 / 邮箱，username 不再是登录入口（DB 字段保留）
//   - 编辑资料页只展示昵称，删除用户名编辑区域
//   - 好友搜索 / 全局搜索 / @提醒 按 nickname 检索，不再按 username
//   - 昵称 30 天冷却返回明确 429 错误
//   - 演唱会贡献者等公开展示统一使用 nickname
//   - username 数据库字段与 nicknameChangedAt 字段保留（未删除 / 未迁移）

const root = join(process.cwd())

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

const profileForm = source('app/profile/ProfileSettingsForm.tsx')
const profileDrawer = source('app/profile/ProfileEditorDrawer.tsx')
const profilePage = source('app/profile/page.tsx')
const usersMe = source('app/api/users/me/route.ts')
const usersLib = source('lib/users.ts')
const friendsList = source('app/api/friends/list/route.ts')
const searchRoute = source('app/api/search/route.ts')
const mentions = source('app/api/friends/mentions/route.ts')
const attribution = source('components/music/ConcertContributorAttribution.tsx')
const schema = source('prisma/schema.prisma')
const loginForm = source('app/login/LoginForm.tsx')

test('登录入口仅支持手机号 / 邮箱（username 不再是登录入口）', () => {
  // 登录查找函数签名已移除 'account'
  assert.match(usersLib, /findCompleteUserByLoginIdentifier\(identifierType: 'phone' \| 'email'/)
  assert.doesNotMatch(usersLib, /identifierType: 'phone' \| 'email' \| 'account'/)
  // 两个用户查找函数都不再包含「按 usernameNormalized 登录」分支
  assert.doesNotMatch(usersLib, /usernameNormalized:\s*normalizedAccount/)
})

test('编辑资料页只展示昵称，删除用户名编辑区域', () => {
  // InitialProfile 类型已无 username / usernameChange
  assert.match(profileForm, /type InitialProfile = \{\s*\n\s*nickname: string/)
  assert.doesNotMatch(profileForm, /更改用户名/)
  // 整个文件不再引用 username
  assert.doesNotMatch(profileForm, /username/i)
  // 抽屉组件同样精简
  assert.doesNotMatch(profileDrawer, /username/i)
  assert.match(profileDrawer, /type InitialProfile = \{\s*\n\s*nickname: string/)
})

test('profile 页面不再查询 / 传递 username 给编辑器', () => {
  assert.doesNotMatch(profilePage, /getUsernameChangeAvailability/)
  assert.doesNotMatch(profilePage, /username: profile\.username/)
  assert.doesNotMatch(profilePage, /usernameChange:/)
  // 仍保留昵称
  assert.match(profilePage, /nickname: true/)
})

test('好友搜索按 nickname，不再按 username', () => {
  assert.doesNotMatch(friendsList, /\{ username: \{ contains: q \} \}/)
  assert.match(friendsList, /\{ nickname: \{ contains: q \} \}/)
})

test('全局搜索按 nickname，不再按 username', () => {
  assert.doesNotMatch(searchRoute, /\{ username: \{ contains: keyword \} \}/)
  assert.match(searchRoute, /\{ nickname: \{ contains: keyword \} \}/)
})

test('好友 @ 提醒按 nickname 排序，不再按 username', () => {
  assert.doesNotMatch(mentions, /friend\.username/)
  assert.match(mentions, /normalized\.nickname/)
})

test('昵称修改冷却返回 429 + NICKNAME_CHANGE_COOLDOWN（含剩余天数）', () => {
  assert.match(usersMe, /NICKNAME_CHANGE_COOLDOWN/)
  assert.match(usersMe, /距离下次修改还有 \$\{daysRemaining\} 天/)
})

test('演唱会贡献者公开展示昵称（ConcertContributorAttribution）', () => {
  assert.match(attribution, /type ConcertContributor = \{ uid: number; nickname: string \}/)
  assert.match(attribution, /contributor\.nickname/)
})

test('登录页只提供手机号 / 邮箱入口，无 username 输入框', () => {
  assert.doesNotMatch(loginForm, /name=["']?username["']?/i)
})

test('username 数据库字段与 nicknameChangedAt 字段保留（未删除 / 未迁移）', () => {
  assert.match(schema, /username\s+String/)
  assert.match(schema, /nicknameChangedAt\s+DateTime/)
})
