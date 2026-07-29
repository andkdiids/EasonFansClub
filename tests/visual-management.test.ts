import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { defaultSiteAppearance, mergeSiteAppearanceConfig } from '../lib/site-config'

const read = (path: string) => readFileSync(path, 'utf8')

test('视觉管理复用 site.appearance JSON 且提供五个可扩展视觉位', () => {
  const config = mergeSiteAppearanceConfig({})
  assert.deepEqual(Object.keys(config.heroVisuals), ['login', 'home', 'activities', 'birthday', 'music'])
  for (const visual of Object.values(config.heroVisuals)) {
    assert.equal(visual.desktopPositionX, 50)
    assert.equal(visual.desktopPositionY, 50)
    assert.equal(visual.mobilePositionX, 50)
    assert.equal(visual.mobilePositionY, 50)
    assert.equal(visual.focusPoint, null)
  }
  const api = read('app/api/admin/appearance/route.ts')
  assert.match(api, /key: 'site\.appearance'/)
  assert.match(api, /requireAdmin\('site_config_manage'\)/)
  assert.ok(defaultSiteAppearance.heroVisuals.login.enabled)
})

test('HeroBackground 用 CSS 变量统一桌面与移动端 position', () => {
  const component = read('components/HeroBackground.tsx')
  const css = read('app/globals.css')
  assert.match(component, /--hero-position-desktop/)
  assert.match(component, /--hero-position-mobile/)
  assert.match(component, /data-desktop-position/)
  assert.match(css, /background-position:var\(--hero-position-desktop\)/)
  assert.match(css, /background-position:var\(--hero-position-mobile\)/)
})

test('后台视觉编辑器支持上传、双预览、滑块、拖拽与独立保存', () => {
  const manager = read('app/admin/visuals/VisualManager.tsx')
  assert.match(manager, /\/api\/uploads\/site-image/)
  assert.match(manager, /data-visual-preview=\{device\}/)
  assert.match(manager, /type="range"/)
  assert.match(manager, /setPointerCapture/)
  assert.match(manager, /desktopPositionX/)
  assert.match(manager, /mobilePositionY/)
  assert.match(manager, /保存当前位置/)
})

test('登录、首页、活动和 EasMusic 接入视觉配置且旧生日页关闭', () => {
  assert.match(read('app/login/page.tsx'), /heroVisual=\{config\.heroVisuals\.login\}/)
  assert.match(read('components/HomeLayoutSurface.tsx'), /siteConfig\.heroVisuals\.home/)
  assert.match(read('app/activities/page.tsx'), /heroVisuals\.activities/)
  assert.match(read('app/birthday/page.tsx'), /redirect\('\/activities'\)/)
  assert.match(read('app/music/page.tsx'), /heroVisuals\.music/)
  assert.match(read('components/music/MusicArchiveShell.tsx'), /backgroundVisual/)
})
