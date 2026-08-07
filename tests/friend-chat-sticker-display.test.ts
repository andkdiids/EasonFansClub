import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const friendDock = read('components/FriendDock.tsx')
const css = read('app/globals.css')
const stickerPicker = read('components/StickerPicker.tsx')

test('私信表情消息不再包裹文字气泡，直接展示图片并限制尺寸', () => {
  // 旧的「气泡内嵌表情」模式已移除：friend-chat-bubble 按钮内不再根据 stickerUrl 渲染图片。
  assert.doesNotMatch(friendDock, /className="friend-chat-bubble"[\s\S]*?\{message\.stickerUrl \?/)

  // 表情消息图片使用 max 120px（移动端）/ 150px（桌面端）+ 圆角 + 等比缩放。
  assert.match(friendDock, /max-w-\[120px\] max-h-\[120px\] rounded-lg object-contain sm:max-w-\[150px\] sm:max-h-\[150px\]/)

  // 仅发送失败时才用无样式按钮包裹（点击重试），成功消息直接渲染图片。
  assert.match(friendDock, /friend-chat-sticker-message/)
  assert.match(friendDock, /message\.status === 'FAILED' \?/)
})

test('文字消息气泡逻辑保持不变（不继承到表情消息）', () => {
  // 文字分支仍使用 friend-chat-bubble。
  assert.match(friendDock, /className="friend-chat-bubble"/)
  assert.match(friendDock, /\{message\.content\}/)
  // 气泡样式仍在 CSS 中保留。
  assert.match(css, /\.friend-chat-bubble \{[^}]*border:1px solid var\(--border\);[^}]*border-radius:14px;[^}]*padding:8px 11px/)
})

test('globals.css 移除气泡内表情规则并新增无样式重试按钮重置', () => {
  // 表情不再在气泡内，旧的后代选择器规则应被移除。
  assert.doesNotMatch(css, /\.friend-chat-bubble \.friend-chat-sticker-img/)
  // 新增 FAILED 重试按钮重置（无 border / background / padding）。
  assert.match(css, /\.friend-chat-sticker-message \{[^}]*display:block;[^}]*border:0;[^}]*background:transparent/)
})

test('表情选择器入口图标优先封面且尺寸 28/32px，顶部标题栏压缩', () => {
  // 入口图标优先 coverUrl，再回退首张表情。
  assert.match(
    stickerPicker,
    /const packIcon = pack\.coverUrl \|\| data\?\.stickersByPack\[pack\.id\]\?\.\[0\]\?\.url \|\| ''/,
  )
  // 尺寸：移动端 28px（h-7 w-7），桌面端 32px（sm:h-8 sm:w-8）；object-cover + rounded-md。
  assert.match(
    stickerPicker,
    /h-7 w-7 flex-none cursor-pointer place-items-center overflow-hidden rounded-md ring-1 transition sm:h-8 sm:w-8/,
  )
  assert.match(stickerPicker, /<img src=\{packIcon\} alt="" className="h-full w-full object-cover" loading="lazy" \/>/)
  // 顶部标题栏压缩上下空白（py-2.5 -> py-1.5）。
  assert.match(
    stickerPicker,
    /header className="flex items-center justify-between border-b border-black\/5 bg-white px-3 py-1\.5"/,
  )
  // 旧的大留白标题栏已不再使用。
  assert.doesNotMatch(stickerPicker, /bg-white px-4 py-2\.5"/)
})
