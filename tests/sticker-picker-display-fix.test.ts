import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 表情选择器 UI 优化（仅前端，锁定微信/QQ 面板体验）：
 * - 面板与内容区背景纯白（bg-white），保留 border / shadow / 圆角；无灰色 bg-[#EDEDED]
 * - 三区域（最近使用 / 默认 emoji / 自定义表情包）统一无 border / 白底 / shadow / 大 padding
 * - 默认 emoji 去掉白底：移动 38px / 桌面 42px，emoji text-[28px] leading-none，紧凑排列
 * - 自定义表情响应式：移动 56px 格 / 48px 图；
 *   · 桌面（md>=768）在「未指定固定列数」时沿用 72px 格 / 60px 图 + 自适应列宽（发帖等）；
 *   · 桌面「指定固定列数」时放大到 80px 格 / 70px 图，并改用 repeat(N,minmax(0,1fr)) 均分（无右侧空白）。
 * - 私信桌面固定 4 列、帖子回复桌面固定 8 列；发帖不传 desktopColumns（沿用自适应）。
 * - 长按预览改为微信式气泡（跟随表情按钮，absolute bottom-full ... 非 fixed），仅移动端 touch 触发，最大 180px，轻微阴影
 * - 桌面无需长按预览（移除 mouse 悬停预览）
 * - 隐藏面板滚动条（保留滚动：touch / wheel），通过 .sticker-wechat-panel > .flex-1 规则
 * - cover 入口图标 coverUrl 优先、回退首表情 逻辑保持不变
 */
const lib = readFileSync(resolve(process.cwd(), 'components/StickerPicker.tsx'), 'utf8')
const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8')

// 0) 面板主体背景纯白：外层面板与内容区均为 bg-white，且全局不再出现灰色 bg-[#EDEDED]
assert.match(lib, /rounded-\[16px\] bg-white shadow-2xl ring-1 ring-black\/10/)
assert.match(lib, /min-h-0 flex-1 overflow-y-auto bg-white/)
assert.doesNotMatch(lib, /bg-\[#EDEDED\]/)

// 1) 自定义表情改用 StickerCell，并接收 previewing 控制长按气泡；尺寸由 desktopCellClass/desktopImgClass 决定
assert.match(lib, /<StickerCell key=\{s\.id\} sticker=\{s\} onSelect=\{\(\) => onSelectSticker\(s\)\} onPreview=\{openPreview\} previewing=\{preview\?\.id === s\.id\}(?: desktopColumns=\{desktopColumns\})? \/>/)
assert.match(lib, /<img src=\{sticker\.url\} alt=\{sticker\.name \|\| ''\} className=\{desktopImgClass\(desktopColumns\)\} loading="lazy" \/>/)

// 2) StickerCell 按钮尺寸由 desktopCellClass(desktopColumns) 决定（移动 56px；桌面 72px 或 80px）
assert.match(lib, /className=\{desktopCellClass\(desktopColumns\)\}/)

// 3) 自定义表情网格：search / pack / 最近使用 三处均通过 desktopGridClass(desktopColumns) 生成
const gridCallSites = lib.split('desktopGridClass(desktopColumns)').length - 1
assert.ok(gridCallSites >= 3, `期望 search / pack / 最近使用 三处均使用 desktopGridClass，实际 ${gridCallSites} 处`)
// 默认（未指定列数）分支保留自适应 72px 列宽
assert.ok(lib.includes('md:grid-cols-[repeat(auto-fill,minmax(72px,72px))]'), '默认分支应使用固定 72px 列宽')
// 固定列数分支使用 repeat(N,minmax(0,1fr)) 均分（无 1fr 拉伸空白大列）
assert.ok(lib.includes('md:grid-cols-[repeat(${cols},minmax(0,1fr))]'), '固定列数分支应使用 repeat(N,minmax(0,1fr))')
assert.ok(!lib.includes('minmax(52px,1fr)'), '不应再出现 1fr 拉伸列（避免右侧空白大列）')

// 4) desktopColumns prop 已在 StickerPicker 上声明
assert.match(lib, /desktopColumns\?: number/)

// 5) 旧的全屏黑色遮罩预览已移除（不再 fixed inset-0 bg-black/50）
assert.doesNotMatch(lib, /fixed inset-0 z-50 flex items-center justify-center bg-black\/50/)

// 6) 微信式长按气泡：跟随表情按钮（非 fixed），移动端长按时出现，松手/移开即关；最大 180px，轻微阴影 shadow-lg
assert.match(lib, /pointer-events-none absolute bottom-full left-1\/2 z-50 mb-2 -translate-x-1\/2 rounded-xl bg-white p-3 shadow-lg/)
assert.match(lib, /<img src=\{sticker\.url\} alt=\{sticker\.name \|\| '表情'\} className="block h-\[180px\] w-\[180px\] rounded-md object-contain"/)

// 7) 长按（touch）500ms 触发预览；滑动取消由 move 逻辑处理（此处仅验证 500ms 定时器）
assert.match(lib, /onPreview\(sticker, 'touch'\)\s*\}, 500\)/)

// 8) 桌面无需长按预览：移除 mouse 悬停预览相关处理
assert.doesNotMatch(lib, /onPreview\(sticker, 'mouse'\)/)
assert.doesNotMatch(lib, /handlePointerEnter/)
assert.doesNotMatch(lib, /handlePointerLeave/)

// 9) ESC 优先关闭预览（previewRef.current 为真时 closePreview，而非关闭整个面板）
assert.match(lib, /if \(previewRef\.current\) \{\s*closePreview\(\)\s*return\s*\}/)
// outside-click 同样在预览时跳过关闭面板
assert.match(lib, /if \(previewRef\.current\) return/)

// 10) cover 入口图标 coverUrl 优先、回退首表情 的逻辑保持不变
assert.match(lib, /const packIcon = pack\.coverUrl \|\| data\?\.stickersByPack\[pack\.id\]\?\.\[0\]\?\.url \|\| ''/)

// 11) 默认 emoji 格子去白底，紧凑 38/42 + text-[28px] leading-none
assert.match(lib, /flex aspect-square h-\[38px\] w-\[38px\] items-center justify-center rounded-md text-\[28px\] leading-none transition hover:bg-slate-100 active:scale-95 md:h-\[42px\] md:w-\[42px\]/)
assert.doesNotMatch(lib, /bg-white text-2xl transition hover:bg-slate-50/)

// 12) 最近使用区域去白底（统一 hover:bg-slate-100），尺寸由 desktopCellClass/desktopImgClass 决定（与 StickerCell 一致）
assert.match(lib, /<img src=\{s\.url\} alt=\{s\.name \|\| ''\} className=\{desktopImgClass\(desktopColumns\)\}/)
assert.match(lib, /className=\{desktopCellClass\(desktopColumns\)\}/)
// EmojiGrid 接收 desktopColumns 并透传给 StickerPicker 调用
assert.match(lib, /<EmojiGrid[\s\S]*?desktopColumns=\{desktopColumns\}/)

// 13) 三个区域标题保留（最近使用 / 默认表情）
assert.match(lib, /<h3 className="px-1 pb-1 text-\[11px\] font-bold uppercase tracking-wider text-slate-500">最近使用<\/h3>/)
assert.match(lib, /<h3 className="px-1 pb-1 text-\[11px\] font-bold uppercase tracking-wider text-slate-500">默认表情<\/h3>/)

// 14) 桌面固定列数尺寸：固定列数时 80px 格 / 70px 图；默认时 72px 格 / 60px 图（由 helper 提供，保障 both 分支存在）
assert.ok(lib.includes('md:h-[80px]'), '固定列数分支应使用 80px 格子高度')
assert.ok(lib.includes('md:h-[70px] md:w-[70px]'), '固定列数分支应使用 70px 图片')
assert.ok(lib.includes('md:h-[72px]'), '默认分支应使用 72px 格子高度')
assert.ok(lib.includes('md:h-[60px] md:w-[60px]'), '默认分支应使用 60px 图片')

// 15) 消费者：私信桌面固定 4 列、帖子回复桌面固定 8 列；发帖不传 desktopColumns（沿用自适应）
const replyForm = readFileSync(resolve(process.cwd(), 'components/ReplyForm.tsx'), 'utf8')
const friendDock = readFileSync(resolve(process.cwd(), 'components/FriendDock.tsx'), 'utf8')
assert.match(replyForm, /<StickerPicker[\s\S]*?desktopColumns=\{8\}/)
assert.match(friendDock, /<StickerPicker[\s\S]*?desktopColumns=\{4\}/)

// 16) 隐藏面板滚动条（保留滚动：touch / wheel），作用于内容区 .sticker-wechat-panel > .flex-1
assert.ok(css.includes('scrollbar-width: none'), '内容区应隐藏滚动条（Firefox）')
assert.ok(css.includes('.sticker-wechat-panel > .flex-1::-webkit-scrollbar { display: none; }'), '内容区应隐藏 webkit 滚动条')

console.log('sticker-picker-display-fix.test.ts: 所有静态断言通过（微信式 UI + 桌面固定列数 + 隐藏滚动条）')
