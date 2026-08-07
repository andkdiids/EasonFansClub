import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 表情选择器展示优化（仅前端）。锁定：
 * - 自定义表情格子去掉白色卡片背景 / border / 过大 padding，图片占满点击区域
 * - 自定义表情格子固定尺寸：移动 42px / 桌面 52px
 * - 长按 / 悬停大图预览遮罩（bg-black/50，手机 80vw / 桌面 400px）
 * - ESC 优先关闭预览；cover 图标 coverUrl 优先逻辑保持不变
 * - 系统 emoji / 最近使用 区域样式保持不变（仍用 bg-white）
 */
const lib = readFileSync(resolve(process.cwd(), 'components/StickerPicker.tsx'), 'utf8')

// 1) 旧的内联白卡 + 固定小图尺寸已移除（search / pack 视图不再这样渲染）
assert.doesNotMatch(lib, /className="flex aspect-square items-center justify-center rounded-md bg-white transition hover:bg-slate-50 active:scale-95"\s*>\s*\{\/\* eslint/)
assert.doesNotMatch(lib, /<img src=\{s\.url\} alt=\{s\.name \|\| ''\} className="h-10 w-10 object-contain"/)

// 2) 自定义表情改用 StickerCell，且图片占满（h-full w-full object-contain），不再固定小尺寸
assert.match(lib, /<StickerCell key=\{s\.id\} sticker=\{s\} onSelect=\{\(\) => onSelectSticker\(s\)\} onPreview=\{openPreview\} \/>/)
assert.match(lib, /<img src=\{sticker\.url\} alt=\{sticker\.name \|\| ''\} className="h-full w-full rounded-md object-contain"/)

// 3) 格子固定尺寸：移动 42px / 桌面 52px
assert.match(lib, /flex h-\[42px\] w-\[42px\] items-center justify-center rounded-md p-1 transition hover:bg-slate-100 active:scale-95 sm:h-\[52px\] sm:w-\[52px\]/)

// 4) 容器改为紧凑 flex-wrap（search 与 pack 两处）
const flexWrapCount = (lib.match(/flex flex-wrap gap-1 px-2 py-2/g) || []).length
assert.ok(flexWrapCount >= 2, `期望 search 与 pack 两处均改为 flex-wrap，实际 ${flexWrapCount} 处`)

// 5) 长按（touch）500ms 触发预览；滑动取消由 move 逻辑处理（此处仅验证 500ms 定时器）
assert.match(lib, /timerRef\.current = window\.setTimeout\(\(\) => \{\s*timerRef\.current = null\s*didPreviewRef\.current = true\s*onPreview\(sticker, 'touch'\)\s*\}, 500\)/)

// 6) 大图预览遮罩：黑色半透明 + 居中 + 限制尺寸（手机 80vw / 桌面 400px）+ object-contain 不裁切
assert.match(lib, /fixed inset-0 z-50 flex items-center justify-center bg-black\/50/)
assert.match(lib, /max-h-\[80vh\] max-w-\[80vw\] rounded-lg object-contain sm:max-w-\[400px\]/)

// 7) ESC 优先关闭预览（previewRef.current 为真时 closePreview，而非关闭整个面板）
assert.match(lib, /if \(previewRef\.current\) \{\s*closePreview\(\)\s*return\s*\}/)
// outside-click 同样在预览时跳过关闭面板
assert.match(lib, /if \(previewRef\.current\) return/)

// 8) cover 图标 coverUrl 优先、回退首表情 的逻辑保持不变
assert.match(lib, /const packIcon = pack\.coverUrl \|\| data\?\.stickersByPack\[pack\.id\]\?\.\[0\]\?\.url \|\| ''/)

// 9) 系统 emoji / 最近使用 区域样式保持不变（仍使用 bg-white 卡片）
assert.match(lib, /grid aspect-square place-items-center rounded-md bg-white text-2xl transition hover:bg-slate-50 active:scale-95/)
assert.match(lib, /<h3 className="px-1 pb-1 text-\[11px\] font-bold uppercase tracking-wider text-slate-500">最近使用<\/h3>/)
assert.match(lib, /<h3 className="px-1 pb-1 text-\[11px\] font-bold uppercase tracking-wider text-slate-500">默认表情<\/h3>/)

console.log('sticker-picker-display-fix.test.ts: 所有静态断言通过')
