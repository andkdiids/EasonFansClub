import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 表情选择器 UI 优化（仅前端，锁定微信/QQ 面板体验）：
 * - 面板与内容区背景纯白（bg-white），保留 border / shadow / 圆角；无灰色 bg-[#EDEDED]
 * - 三区域（最近使用 / 默认 emoji / 自定义表情包）统一无 border / 白底 / shadow / 大 padding
 * - 默认 emoji 去掉白底：回复面板使用 32px 紧凑排列，私信面板按网格自然铺开，均保持无白底
 * - 自定义表情通过静态网格类和 CSS 变量控制列数/最大宽度，避免动态 Tailwind 类名失效；
 * - 私信通过固定的移动/桌面列数限制网格，帖子回复使用独立的 8 列桌面网格；
 * - 长按预览使用 body portal + fixed 定位，跟随 anchor 计算位置，仅移动端 touch 触发，最大 180px。
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

// 1) 自定义表情统一走 StickerCell；格子和图片尺寸由稳定 helper 提供
assert.match(lib, /<StickerCell key=\{s\.id\} sticker=\{s\} onSelect=\{\(\) => onSelectSticker\(s\)\} onPreview=\{openPreview\} \/>/)
assert.match(lib, /<img src=\{publicImageVariantUrl\(sticker\.url, 'thumb-sm'\) \|\| sticker\.url\} alt=\{sticker\.name \|\| ''\} className=\{desktopImgClass\(\)\} loading="lazy" \/>/)

// 2) StickerCell 使用 aspect-square 网格项，实际列宽由网格 CSS 变量控制
assert.match(lib, /className=\{desktopCellClass\(\)\}/)

// 3) 自定义表情网格通过静态 class + CSS 变量渲染；搜索和表情包视图复用同一网格
const gridCallSites = lib.split('className={gridClassName}').length - 1
assert.ok(gridCallSites >= 2, `期望 search / pack 两处复用 gridClassName，实际 ${gridCallSites} 处`)
assert.match(lib, /const gridStyle = \{[\s\S]*'--sg-cols'/)
assert.match(lib, /const gridClassName = isReply[\s\S]*sticker-pack-grid/)
assert.match(css, /\.sticker-pack-grid \{[\s\S]*grid-template-columns: repeat\(var\(--sg-cols, 5\), minmax\(0, 1fr\)\)/)
assert.match(css, /\.sticker-pack-grid \{[\s\S]*grid-template-columns: repeat\(var\(--sg-cols-md, var\(--sg-cols, 5\)\), minmax\(0, 1fr\)\)/)
assert.ok(!lib.includes('minmax(52px,1fr)'), '不应回退到旧的动态 1fr 类名')

// 4) desktopColumns prop 已在 StickerPicker 上声明
assert.match(lib, /desktopColumns\?: number/)

// 5) 旧的全屏黑色遮罩预览已移除（不再 fixed inset-0 bg-black/50）
assert.doesNotMatch(lib, /fixed inset-0 z-50 flex items-center justify-center bg-black\/50/)

// 6) 预览通过 body portal 脱离面板裁剪，位置由 anchor/viewport 计算且保持 object-contain
assert.match(lib, /createPortal\(previewLayer, document\.body\)/)
assert.match(lib, /position: 'fixed'/)
assert.match(lib, /className="pointer-events-none rounded-2xl bg-white p-3 shadow-2xl ring-1 ring-black\/10"/)
assert.match(lib, /<img src=\{publicImageVariantUrl\(preview\.url, 'card'\) \|\| preview\.url\} alt=\{preview\.name \|\| '表情'\} className="block h-full w-full object-contain"/)

// 7) 长按（touch）500ms 触发预览；滑动取消由 move 逻辑处理（此处仅验证 500ms 定时器）
assert.match(lib, /onPreview\(sticker, 'touch', anchor\)\s*\}, 500\)/)

// 8) 桌面无需长按预览：移除 mouse 悬停预览相关处理
assert.doesNotMatch(lib, /onPreview\(sticker, 'mouse'\)/)
assert.doesNotMatch(lib, /handlePointerEnter/)
assert.doesNotMatch(lib, /handlePointerLeave/)

// 9) ESC 优先关闭预览（previewRef.current 为真时 closePreview，而非关闭整个面板）
assert.match(lib, /if \(previewRef\.current\) \{\s*closePreview\(\)\s*return\s*\}/)
// outside-click 同样在预览时跳过关闭面板
assert.match(lib, /if \(previewRef\.current\) \{[\s\S]*closePreview\(\)[\s\S]*return/)

// 10) cover 入口图标 coverUrl 优先、回退首表情 的逻辑保持不变
assert.match(lib, /const packIcon = pack\.coverUrl \|\| data\?\.stickersByPack\[pack\.id\]\?\.\[0\]\?\.url \|\| ''/)

// 11) 默认 emoji 格子去白底：回复面板紧凑，私信面板使用自然网格
assert.match(lib, /'flex h-8 w-8 items-center justify-center rounded-md text-\[28px\] leading-none transition hover:bg-slate-100 active:scale-95'/)
assert.match(lib, /'flex aspect-square items-center justify-center rounded-md text-\[24px\] leading-none transition hover:bg-slate-100 active:scale-95'/)
assert.doesNotMatch(lib, /bg-white text-2xl transition hover:bg-slate-50/)

// 12) 最近使用区域保持紧凑无白底，图片使用公共媒体变体并完整显示
assert.match(lib, /<img src=\{publicImageVariantUrl\(s\.url, 'thumb-sm'\) \|\| s\.url\} alt=\{s\.name \|\| ''\} className="h-full w-full object-contain p-0\.5"/)
assert.match(lib, /className="grid h-10 w-10 place-items-center rounded-md transition hover:bg-slate-100 active:scale-95 md:h-12 md:w-12"/)

// 13) 三个区域标题保留（最近使用 / 默认表情）
assert.match(lib, /<h3 className="px-1 pb-1 text-\[11px\] font-bold uppercase tracking-wider text-slate-500">最近使用<\/h3>/)
assert.match(lib, /<h3 className="px-1 pb-1 text-\[11px\] font-bold uppercase tracking-wider text-slate-500">默认表情<\/h3>/)

// 14) 桌面/移动列数通过 props → CSS 变量传入，Reply 网格在桌面固定 8 列
assert.match(lib, /'--sg-cols': String\(mobileColumns \?\? 5\)/)
assert.match(lib, /'--sg-cols-md': String\(desktopColumns \?\? mobileColumns \?\? 5\)/)
assert.match(css, /\.sticker-reply-grid \{[\s\S]*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/)
assert.match(css, /\.sticker-reply-grid \{[\s\S]*grid-template-columns: repeat\(8, 64px\)/)

// 15) 消费者：私信显式 5 列和 64px 单元格；帖子回复使用 reply 变体的 8 列桌面网格
const replyForm = readFileSync(resolve(process.cwd(), 'components/ReplyForm.tsx'), 'utf8')
const friendDock = readFileSync(resolve(process.cwd(), 'components/FriendDock.tsx'), 'utf8')
assert.match(replyForm, /<StickerPicker[\s\S]*?variant="reply"/)
assert.match(friendDock, /<StickerPicker[\s\S]*?mobileColumns=\{5\}[\s\S]*?desktopColumns=\{5\}/)
assert.match(friendDock, /mobileCellPx=\{64\}[\s\S]*?desktopCellPx=\{64\}/)

// 16) 隐藏面板滚动条（保留滚动：touch / wheel），作用于内容区 .sticker-wechat-panel > .flex-1
assert.ok(css.includes('scrollbar-width: none'), '内容区应隐藏滚动条（Firefox）')
assert.ok(css.includes('.sticker-wechat-panel > .flex-1::-webkit-scrollbar { display: none; }'), '内容区应隐藏 webkit 滚动条')

console.log('sticker-picker-display-fix.test.ts: 所有静态断言通过（微信式 UI + 桌面固定列数 + 隐藏滚动条）')
