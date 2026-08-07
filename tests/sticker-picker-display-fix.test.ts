import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 表情选择器 UI 优化（仅前端，锁定微信/QQ 面板体验）：
 * - 面板与内容区背景纯白（bg-white），保留 border / shadow / 圆角；无灰色 bg-[#EDEDED]
 * - 三区域（最近使用 / 默认 emoji / 自定义表情包）统一无 border / 白底 / shadow / 大 padding
 * - 默认 emoji 去掉白底：移动 38px / 桌面 42px，emoji text-[28px] leading-none，紧凑排列
 * - 自定义表情包响应式：移动 42px 格 / 36px 图；桌面(md>=768) 56px 格 / 48px(w-12 h-12) 图
 * - 表情网格改为 auto-fill 自适应列（消除右侧空白占位列），单元格 w-full 填充轨道
 * - 长按预览改为微信式气泡（跟随表情按钮，absolute bottom-full ... 非 fixed），仅移动端 touch 触发，最大 180px，轻微阴影
 * - 桌面无需长按预览（移除 mouse 悬停预览）
 * - cover 入口图标 coverUrl 优先、回退首表情 逻辑保持不变
 * - 系统 emoji / 最近使用 区域仍保留（不再使用白底卡片）
 */
const lib = readFileSync(resolve(process.cwd(), 'components/StickerPicker.tsx'), 'utf8')

// 0) 面板主体背景纯白：外层面板与内容区均为 bg-white，且全局不再出现灰色 bg-[#EDEDED]
assert.match(lib, /rounded-\[16px\] bg-white shadow-2xl ring-1 ring-black\/10/)
assert.match(lib, /min-h-0 flex-1 overflow-y-auto bg-white/)
assert.doesNotMatch(lib, /bg-\[#EDEDED\]/)

// 1) 自定义表情改用 StickerCell，并接收 previewing 控制长按气泡；图片 36/48 响应式
assert.match(lib, /<StickerCell key=\{s\.id\} sticker=\{s\} onSelect=\{\(\) => onSelectSticker\(s\)\} onPreview=\{openPreview\} previewing=\{preview\?\.id === s\.id\} \/>/)
assert.match(lib, /<img src=\{sticker\.url\} alt=\{sticker\.name \|\| ''\} className="h-\[36px\] w-\[36px\] rounded-md object-contain md:h-12 md:w-12"/)

// 2) 自定义格子响应式尺寸：移动 42px / 桌面(md) 56px；宽度改为 w-full 填充网格轨道；无 border / 白底 / shadow / 大 padding
assert.match(lib, /relative flex h-\[42px\] w-full items-center justify-center rounded-md transition hover:bg-slate-100 active:scale-95 md:h-\[56px\]/)

// 3) 表情网格改为 auto-fill 自适应列（search 与 pack 两处），消除右侧空白占位列
const autoFillCount = (lib.match(/grid grid-cols-\[repeat\(auto-fill,minmax\(52px,1fr\)\)\] gap-2 px-2 py-2/g) || []).length
assert.ok(autoFillCount >= 2, `期望 search 与 pack 两处均改为 auto-fill 网格，实际 ${autoFillCount} 处`)

// 4) 旧的全屏黑色遮罩预览已移除（不再 fixed inset-0 bg-black/50）
assert.doesNotMatch(lib, /fixed inset-0 z-50 flex items-center justify-center bg-black\/50/)

// 5) 微信式长按气泡：跟随表情按钮（非 fixed），移动端长按时出现，松手/移开即关；最大 180px，轻微阴影 shadow-lg
assert.match(lib, /pointer-events-none absolute bottom-full left-1\/2 z-50 mb-2 -translate-x-1\/2 rounded-xl bg-white p-3 shadow-lg/)
assert.match(lib, /<img src=\{sticker\.url\} alt=\{sticker\.name \|\| '表情'\} className="block h-\[180px\] w-\[180px\] rounded-md object-contain"/)

// 6) 长按（touch）500ms 触发预览；滑动取消由 move 逻辑处理（此处仅验证 500ms 定时器）
assert.match(lib, /onPreview\(sticker, 'touch'\)\s*\}, 500\)/)

// 7) 桌面无需长按预览：移除 mouse 悬停预览相关处理
assert.doesNotMatch(lib, /onPreview\(sticker, 'mouse'\)/)
assert.doesNotMatch(lib, /handlePointerEnter/)
assert.doesNotMatch(lib, /handlePointerLeave/)

// 8) ESC 优先关闭预览（previewRef.current 为真时 closePreview，而非关闭整个面板）
assert.match(lib, /if \(previewRef\.current\) \{\s*closePreview\(\)\s*return\s*\}/)
// outside-click 同样在预览时跳过关闭面板
assert.match(lib, /if \(previewRef\.current\) return/)

// 9) cover 入口图标 coverUrl 优先、回退首表情 的逻辑保持不变
assert.match(lib, /const packIcon = pack\.coverUrl \|\| data\?\.stickersByPack\[pack\.id\]\?\.\[0\]\?\.url \|\| ''/)

// 10) 默认 emoji 格子去白底，紧凑 38/42 + text-[28px] leading-none
assert.match(lib, /flex aspect-square h-\[38px\] w-\[38px\] items-center justify-center rounded-md text-\[28px\] leading-none transition hover:bg-slate-100 active:scale-95 md:h-\[42px\] md:w-\[42px\]/)
assert.doesNotMatch(lib, /bg-white text-2xl transition hover:bg-slate-50/)

// 11) 最近使用区域去白底（统一 hover:bg-slate-100），图片 36px
assert.match(lib, /<img src=\{s\.url\} alt=\{s\.name \|\| ''\} className="h-\[36px\] w-\[36px\] object-contain"/)
assert.doesNotMatch(lib, /grid aspect-square place-items-center rounded-md bg-white transition hover:bg-slate-50 active:scale-95/)

// 12) 三个区域标题保留（最近使用 / 默认表情）
assert.match(lib, /<h3 className="px-1 pb-1 text-\[11px\] font-bold uppercase tracking-wider text-slate-500">最近使用<\/h3>/)
assert.match(lib, /<h3 className="px-1 pb-1 text-\[11px\] font-bold uppercase tracking-wider text-slate-500">默认表情<\/h3>/)

console.log('sticker-picker-display-fix.test.ts: 所有静态断言通过（微信式 UI）')
