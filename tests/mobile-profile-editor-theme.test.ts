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

test('背景裁剪器使用响应式预览宽度、固定 9:2 比例和独立可滚动正文', () => {
  const form = read('app/profile/ProfileSettingsForm.tsx')
  const css = read('app/globals.css')
  assert.match(form, /profile-background-crop-overlay/)
  assert.match(form, /ref=\{backgroundFrameRef\}/)
  assert.match(form, /backgroundFrameSize\.width[\s\S]*backgroundFrameSize\.height/)
  assert.match(form, /previewFrameWidth: backgroundFrameSize\.width/)
  assert.doesNotMatch(form, /style=\{\{ width: BACKGROUND_FRAME_WIDTH, height: BACKGROUND_FRAME_HEIGHT \}\}/)
  assert.match(css, /\.profile-background-crop \{[^}]*width:100%;[^}]*max-width:32rem;[^}]*min-width:0;/)
  assert.match(css, /\.profile-background-crop-frame \{[^}]*width:100%;[^}]*max-width:450px;[^}]*min-width:0;[^}]*aspect-ratio:9 \/ 2;/)
  assert.match(css, /\.profile-background-crop-content \{[^}]*min-width:0;[^}]*min-height:0;[^}]*overflow-x:hidden;[^}]*overflow-y:auto;/)
  assert.match(css, /\.profile-background-crop-range \{[^}]*width:100%;[^}]*max-width:100%;[^}]*min-width:0;/)
  assert.match(css, /\.profile-background-crop-actions \{[^}]*width:100%;[^}]*max-width:100%;/)
  assert.match(css, /\.profile-background-crop-confirm \{ flex:0 1 auto; \}/)
  assert.match(css, /@media \(max-width:767px\)[\s\S]*\.profile-background-crop-confirm \{ flex:1 1 0; \}/)
  assert.match(css, /max-height:calc\(100dvh - max\(24px,calc\(env\(safe-area-inset-top,0px\) \+ env\(safe-area-inset-bottom,0px\) \+ 24px\)\)\)/)
})

test('背景裁剪仍复用原有确认上传和拖动逻辑', () => {
  const form = read('app/profile/ProfileSettingsForm.tsx')
  assert.match(form, /onPointerDown=\{onBackgroundCropPointerDown\}/)
  assert.match(form, /onPointerMove=\{onBackgroundCropPointerMove\}/)
  assert.match(form, /onClick=\{confirmBackgroundUpload\}/)
  assert.match(form, /body\.append\('kind', 'background'\)/)
  assert.match(form, /canvasToBlobWithFallback\(canvas\)/)
})
