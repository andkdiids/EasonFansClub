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

test('背景预览从 initialProfile.backgroundUrl 初始化', () => {
  assert.match(form, /const \[backgroundPreview, setBackgroundPreview\] = useState\(initialProfile\.backgroundUrl \|\| ''\)/)
})

test('背景预览使用 <img object-cover> 缩略图而非空白占位，上传后继续覆盖', () => {
  // 有背景时渲染 img（object-cover 缩略图），无背景时才显示占位
  assert.match(form, /<img\s+src=\{backgroundPreview\}[\s\S]*?className="aspect-\[16\/7\] w-full object-cover"/)
  assert.match(form, /背景预览/)
  // 上传成功后继续覆盖 preview
  assert.match(form, /setForm\(\(current\) => \(\{ \.\.\.current, backgroundUrl: data\.url \}\)\)\s*\n\s*setBackgroundPreview\(data\.url\)/)
})

test('背景上传入口保持原有 label/id/accept（不影响上传流程）', () => {
  assert.match(form, /htmlFor="profile-background-upload"/)
  assert.match(form, /id="profile-background-upload"/)
  assert.match(form, /accept="image\/jpeg,image\/png,image\/webp"/)
})
