import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('E院中心增加好友动态且保留管理员条件入口', () => {
  const navigation = read('components/layout/MobileNavigation.tsx')
  const registry = read('lib/navigation-registry.ts')
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
  assert.match(css, /\.profile-editor-scroll \{[^}]*padding-bottom:calc\(var\(--mobile-profile-action-bar-total\) \+ 16px\)/)
  assert.match(css, /@media \(max-width:767px\)[\s\S]*\.profile-settings-form \.profile-settings-actions \{ left:0; width:100%; \}/)
})

test('移动端隐藏重复的个人资料编辑器眉标题但保留编辑资料主标题', () => {
  const drawer = read('app/profile/ProfileEditorDrawer.tsx')
  const form = read('app/profile/ProfileSettingsForm.tsx')
  const css = read('app/globals.css')
  assert.match(drawer, /profile-editor-eyebrow[\s\S]*个人资料编辑器/)
  assert.match(form, /profile-settings-intro[\s\S]*profile-editor-eyebrow[\s\S]*个人资料编辑器/)
  assert.match(css, /@media \(max-width:767px\)[\s\S]*\.profile-editor-header \.profile-editor-eyebrow \{ display:none; \}[\s\S]*\.profile-editor-header h2 \{ margin-top:0; \}[\s\S]*\.profile-settings-intro \{ display:none; \}/)
})

test('背景设置器复用单一源图并提供桌面端与移动端独立变换', () => {
  const form = read('app/profile/ProfileSettingsForm.tsx')
  const editor = read('components/ProfileBackgroundEditor.tsx')
  const image = read('components/ProfileBackgroundImage.tsx')
  const helper = read('lib/profile-background.ts')
  const css = read('app/globals.css')
  assert.match(form, /<ProfileBackgroundEditor/)
  assert.match(editor, /backgroundDesktopTransform|desktopTransform/)
  assert.match(editor, /backgroundMobileTransform|mobileTransform/)
  assert.match(editor, /profileBackgroundTransformStyle/)
  assert.match(editor, /profileBackgroundTransformToFields|onUploaded/)
  assert.match(image, /src=\{sourceUrl\}/)
  assert.equal((image.match(/<ProfileBackgroundLayer/g) || []).length, 2)
  assert.match(image, /device="mobile"/)
  assert.match(image, /device="desktop"/)
  assert.match(helper, /PROFILE_BACKGROUND_BREAKPOINT_PX = 768/)
  assert.match(helper, /getProfileBackgroundConstraints/)
  assert.match(helper, /PROFILE_BACKGROUND_MIN_SCALE = 0\.4/)
  assert.match(helper, /updateProfileBackgroundTransformForDrag/)
  assert.match(css, /\.profile-background-layer \{[^}]*overflow:hidden[^}]*background:#000/)
  assert.match(css, /\.profile-background-layer-mobile \{ display:block; \}/)
  assert.match(css, /@media \(min-width:768px\)[\s\S]*\.profile-background-layer-desktop \{ display:block; \}/)
})

test('背景上传保留原图并在设置器内处理两端拖动与缩放', () => {
  const editor = read('components/ProfileBackgroundEditor.tsx')
  const uploadRoute = read('app/api/uploads/profile-image/route.ts')
  assert.match(editor, /onPointerDown=\{onPointerDown\}/)
  assert.match(editor, /onPointerMove=\{onPointerMove\}/)
  assert.match(editor, /body\.append\('file', pendingFile, pendingFile\.name\)/)
  assert.match(editor, /body\.append\('kind', 'background'\)/)
  assert.doesNotMatch(editor, /canvasToBlobWithFallback/)
  assert.match(uploadRoute, /backgroundDesktopScale: null/)
  assert.match(uploadRoute, /backgroundMobileScale: null/)
})
