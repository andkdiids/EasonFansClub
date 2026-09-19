import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const form = readFileSync('app/profile/ProfileSettingsForm.tsx', 'utf8')

test('头像预览为圆形且带边框阴影，不依赖固定高度拉伸', () => {
  // 圆形 + 80px + 边框 + 阴影 + 裁剪
  assert.match(form, /<span className="block h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-slate-200 shadow">/)
  // 头像由 SafeAvatar 以 object-cover 填满，不再使用 bg-brand-950 方块兜底
  assert.match(form, /<SafeAvatar src=\{avatarPreview\} name=\{form\.nickname\} className="h-full w-full"/)
  assert.doesNotMatch(form, /grid place-items-center bg-brand-950 text-2xl font-black text-white/)
})

test('头像与背景卡片不拉伸留白：网格使用 items-start', () => {
  assert.match(form, /<div className="grid items-start gap-4 md:grid-cols-2">/)
})

test('背景编辑器使用同一源图并保存桌面与移动端两套变换', () => {
  assert.match(form, /<ProfileBackgroundEditor/)
  assert.match(form, /sourceUrl=\{form\.backgroundUrl\}/)
  assert.match(form, /desktopTransform=\{form\.backgroundDesktopTransform\}/)
  assert.match(form, /mobileTransform=\{form\.backgroundMobileTransform\}/)
  assert.match(form, /backgroundDesktopTransform: desktop/)
  assert.match(form, /backgroundMobileTransform: mobile/)
})

test('背景保存请求包含两端变换，上传后会重置为新源图配置', () => {
  assert.match(form, /payload\.backgroundDesktopTransform = form\.backgroundDesktopTransform \?\? null/)
  assert.match(form, /payload\.backgroundMobileTransform = form\.backgroundMobileTransform \?\? null/)
  assert.match(form, /背景图已上传，点击“保存资料”后保存两端显示配置。/)
})
