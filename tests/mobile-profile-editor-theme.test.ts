import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('E院中心增加好友动态且保留管理员条件入口', () => {
  const navigation = read('components/layout/MobileNavigation.tsx')
  const registry = read('lib/ecenter-features.ts')
  assert.match(registry, /featureKey: 'FRIEND_ACTIVITY',[\s\S]*href: '\/friends\/activity'/)
  assert.match(navigation, /ecenterFeatures\.filter/)
  assert.match(navigation, /requiresAdmin/)
  assert.doesNotMatch(navigation, /const centerItems = \[/)
})

test('资料编辑器使用全站主题 Surface 和前景色', () => {
  const drawer = read('app/profile/ProfileEditorDrawer.tsx')
  const form = read('app/profile/ProfileSettingsForm.tsx')
  const css = read('app/globals.css')
  assert.match(drawer, /profile-editor-header/)
  assert.match(drawer, /profile-editor-scroll/)
  assert.match(form, /profile-settings-form/)
  assert.match(css, /\.profile-editor-drawer \{[^}]*color:var\(--foreground\);[^}]*background:var\(--background\)/)
  assert.match(css, /\.profile-editor-header \{[^}]*background:var\(--surface-elevated\)/)
  assert.match(css, /\.profile-settings-form>section \{[^}]*background:var\(--surface-elevated\)/)
  assert.match(css, /input:not\(\[type='file'\]\)[^}]*background:var\(--surface\)/)
  assert.match(css, /:root\[data-theme='midnight'\] \.profile-settings-form/)
})

test('资料编辑底栏固定、等宽、安全区适配并为内容预留空间', () => {
  const css = read('app/globals.css')
  assert.match(css, /\.profile-settings-form \.profile-settings-actions \{[^}]*position:fixed;[^}]*right:0;[^}]*bottom:0;/)
  assert.match(css, /width:min\(100%,42rem\)/)
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(css, /var\(--mobile-safe-area-bottom\)/)
  assert.match(css, /\.profile-editor-scroll \{[^}]*padding-bottom:calc\(var\(--mobile-bottom-nav-height\) \+ var\(--mobile-safe-area-bottom\) \+ 28px\)/)
  assert.match(css, /@media \(max-width:767px\)[\s\S]*\.profile-settings-form \.profile-settings-actions \{ left:0; width:100%; \}/)
})
