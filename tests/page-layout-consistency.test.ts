import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('页面布局编辑系统已从应用层下线', () => {
  const removedFiles = [
    'app/admin/layout-editor/page.tsx',
    'app/admin/layout-editor/LayoutEditorClient.tsx',
    'app/api/page-layouts/[pageKey]/route.ts',
    'app/api/admin/page-layouts/[pageKey]/route.ts',
    'components/AdminLayoutQuickLink.tsx',
    'components/page-layout/PageLayoutRenderer.tsx',
    'components/page-layout/PageLayoutFrame.tsx',
    'lib/page-layout/service.ts',
    'lib/page-layout/registry.ts',
  ]
  for (const path of removedFiles) assert.equal(existsSync(path), false, path)

  const applicationFiles = [
    'app/layout.tsx',
    'app/admin/page.tsx',
    'app/checkin/page.tsx',
    'app/forum/page.tsx',
    'app/music/page.tsx',
    'app/notifications/page.tsx',
    'app/profile/page.tsx',
    'components/layout/AppShell.tsx',
    'components/layout/Topbar.tsx',
    'components/SiteHeader.tsx',
  ]
  for (const path of applicationFiles) {
    assert.doesNotMatch(read(path), /PageLayoutRenderer|getPublishedPageLayoutConfig|getDefaultPageLayoutConfig|layoutConfig|layout\.manage|layout\.publish|AdminLayoutQuickLink|canManageLayout|layout-editor/)
  }
})

test('首页和每日挂号由页面代码直接控制响应式布局', () => {
  const home = read('components/HomeLayoutSurface.tsx')
  const checkin = read('components/CheckInPageSurface.tsx')
  assert.match(home, /<HomeHero/)
  assert.match(home, /home-first-row/)
  assert.match(home, /home-primary-columns/)
  assert.doesNotMatch(home, /PageLayoutRenderer|getPublishedPageLayoutConfig|layoutConfig/)
  assert.match(checkin, /<section data-checkin-main-card="true"/)
  assert.match(checkin, /grid grid-cols-2 gap-2\.5/)
  assert.match(checkin, /max-w-\[504px\] md:max-w-\[1040px\]/)
  assert.match(checkin, /data-checkin-level-row="true"/)
  assert.match(checkin, /<CheckInGrowthGuideCard \/>/)
  assert.match(checkin, /<CheckInMakeupEntry \/>[\s\S]*<CheckInHistoryDialog/)
  assert.doesNotMatch(checkin, /E院病友人数|今日挂号人数|今日情绪指数|\{dailyQuote\}/)
  assert.doesNotMatch(checkin, /previewMode|density|PageLayout|layoutConfig/)
})

test('每日挂号恢复图二固定信息层级并保留签到结果展示', () => {
  const layout = read('components/CheckInPageSurface.tsx')
  const button = read('components/CheckInButton.tsx')
  assert.equal((layout.match(/\['(?:E院人数|今日挂号|连续天数|累计天数)'/g) || []).length, 4)
  assert.match(layout, /data-checkin-stats-grid="true" className="mt-5 grid grid-cols-2/)
  assert.match(layout, /TodayRegistrationFeePanel/)
  assert.match(button, /data-checkin-mood-card="true"/)
  assert.match(button, /今日挂号成功，获得 \+\$\{todayCheckIn\.points\}/)
  assert.match(button, /getStreakBonus\(todayCheckIn\.streakDay\)/)
  assert.doesNotMatch(button, /Today's Check-in|今天也来报到吧/)
})

test('应用层没有布局动态样式残留或布局编辑依赖', () => {
  const css = read('app/globals.css')
  const packageJson = read('package.json')
  assert.doesNotMatch(css, /\.page-layout-|data-layout|\.layout-card|\.page-density-/)
  assert.doesNotMatch(packageJson, /react-grid-layout|react-resizable/)
})

test('视觉外观配置与个人背景上传不受布局系统下线影响', () => {
  const siteConfig = read('lib/site-config.ts')
  const appearanceApi = read('app/api/admin/appearance/route.ts')
  const appearanceForm = read('app/admin/appearance/AppearanceForm.tsx')
  const visualManager = read('app/admin/visuals/VisualManager.tsx')
  const heroBackground = read('components/HeroBackground.tsx')
  const profilePage = read('app/profile/page.tsx')
  const profileSettings = read('app/profile/ProfileSettingsForm.tsx')
  const themeToggle = read('components/ThemeToggle.tsx')

  assert.match(siteConfig, /background: string/)
  assert.match(siteConfig, /loginBackgroundUrl: string/)
  assert.match(siteConfig, /defaultProfileBackgroundUrl: string/)
  assert.match(siteConfig, /checkinBackgroundUrl: string/)
  assert.match(siteConfig, /heroVisuals: Record/)
  assert.match(appearanceApi, /key: 'site\.appearance'/)
  assert.match(appearanceForm, /\/api\/uploads\/site-image/)
  assert.match(visualManager, /\/api\/admin\/appearance/)
  assert.match(heroBackground, /backgroundColor: '#071523'/)
  assert.match(heroBackground, /objectPosition/)
  assert.match(profilePage, /backgroundUrl/)
  assert.match(profileSettings, /kind', 'background'/)
  assert.match(themeToggle, /ecfc-theme/)
})
