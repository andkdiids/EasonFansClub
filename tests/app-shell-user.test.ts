import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('AppShell 使用刷新后的统一用户资料和真实成长数据', () => {
  const layout = read('app/layout.tsx')
  const auth = read('lib/auth.ts')
  const sidebar = read('components/layout/Sidebar.tsx')
  assert.match(layout, /getCurrentUser\(\)/)
  assert.match(layout, /getGrowthSummary\(sessionUser\.experience \|\| 0\)/)
  assert.match(auth, /profile:\s*\{ select: \{ id: true, avatarUrl: true \} \}/)
  assert.match(auth, /avatarUrl: user\.profile\?\.avatarUrl \|\| user\.avatarUrl \|\| null/)
  assert.doesNotMatch(sidebar, /fetch\('\/api\/home'/)
  assert.match(sidebar, /<UserProfileSummary user=\{user\} growth=\{growth\}/)
})

test('Sidebar 与 Topbar 共用头像组件且成长文案不再显示 Lv', () => {
  const sidebar = read('components/layout/Sidebar.tsx')
  const topbar = read('components/layout/Topbar.tsx')
  const summary = read('components/UserProfileSummary.tsx')
  assert.match(summary, /<UserAvatar user=\{user\}/)
  assert.match(topbar, /<UserAvatar user=\{user\}/)
  assert.match(summary, /等级 \{growth\.level\}/)
  assert.match(summary, /EXP/)
  assert.doesNotMatch(sidebar + summary, /Lv\./)
})

test('用户菜单、后台入口与布局编辑入口沿用权限结果', () => {
  const layout = read('app/layout.tsx')
  const shell = read('components/layout/AppShell.tsx')
  const topbar = read('components/layout/Topbar.tsx')
  const sidebar = read('components/layout/Sidebar.tsx')
  for (const label of ['我的主页', '消息中心', '我的收藏', '签到记录', '账号安全', '退出登录']) {
    assert.match(topbar, new RegExp(label))
  }
  assert.match(layout, /hasAdminPermission\(sessionUser, 'layout\.manage'\)/)
  assert.match(layout, /hasAdminPermission\(sessionUser\)/)
  assert.match(shell, /canManageLayout=\{canManageLayout\}/)
  assert.match(topbar, /canManageLayout \? <Link href="\/admin\/layout-editor"/)
  assert.match(topbar, /canAccessAdmin \? <Link href="\/admin"/)
  assert.match(sidebar, /canAccessAdmin \? <nav[\s\S]*href="\/admin"/)
})

test('ICP备案在登录页和 Sidebar 复用同一组件', () => {
  const record = read('components/IcpRecord.tsx')
  assert.match(record, /粤ICP备2026099247号-1/)
  assert.match(record, /https:\/\/beian\.miit\.gov\.cn/)
  assert.match(read('app/login/page.tsx'), /<IcpRecord inverse/)
  assert.match(read('components/layout/Sidebar.tsx'), /<IcpRecord \/>/)
})
