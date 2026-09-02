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
  assert.match(auth, /Profile:\s*\{ select: \{ id: true, avatarUrl: true, displayName: true, displayNameModerationStatus: true \} \}/)
  assert.match(auth, /avatarUrl: publicImageUrl\(user\.Profile\?\.avatarUrl \|\| user\.avatarUrl\)/)
  assert.doesNotMatch(sidebar, /fetch\('\/api\/home'/)
  assert.match(sidebar, /<UserProfileSummary user=\{user\} growth=\{growth\}/)
})

test('Sidebar 与 Topbar 共用头像组件且成长文案不再显示 Lv', () => {
  const sidebar = read('components/layout/Sidebar.tsx')
  const topbar = read('components/layout/Topbar.tsx')
  const summary = read('components/UserProfileSummary.tsx')
  assert.match(summary, /<UserAvatar user=\{user\}/)
  assert.match(topbar, /<UserAvatar user=\{user\}/)
  assert.match(summary, /resolveGrowthLevelName\(growth\.level, growth\.levelName\)/)
  assert.match(summary, /EXP/)
  assert.doesNotMatch(sidebar + summary, /Lv\./)
})

test('用户菜单与后台入口沿用权限结果且不再提供布局编辑入口', () => {
  const layout = read('app/layout.tsx')
  const shell = read('components/layout/AppShell.tsx')
  const topbar = read('components/layout/Topbar.tsx')
  const sidebar = read('components/layout/Sidebar.tsx')
  for (const label of ['个人病历', '消息中心', '我的收藏', '账号安全', '退出登录']) {
    assert.match(topbar, new RegExp(label))
  }
  assert.doesNotMatch(topbar + sidebar, /签到记录/)
  assert.match(layout, /hasAdminPermission\(sessionUser\)/)
  assert.doesNotMatch(layout + shell + topbar, /layout\.manage|layout\.publish|AdminLayoutQuickLink|canManageLayout|layout-editor/)
  assert.match(topbar, /canAccessAdmin \? \(/)
  assert.match(topbar, /<Link href="\/admin"/)
  assert.match(sidebar, /!item\.requiresAdmin \|\| canAccessAdmin/)
})

test('ICP备案在登录页和 AppShell Footer 复用同一组件', () => {
  const record = read('components/IcpRecord.tsx')
  assert.match(record, /粤ICP备2026099247号-1/)
  assert.match(record, /https:\/\/beian\.miit\.gov\.cn/)
  assert.match(read('app/login/page.tsx'), /<IcpRecord inverse/)
  assert.doesNotMatch(read('components/layout/Sidebar.tsx'), /IcpRecord/)
  assert.match(read('components/layout/AppShell.tsx'), /<footer className="site-footer-info"><IcpRecord \/><\/footer>/)
})
