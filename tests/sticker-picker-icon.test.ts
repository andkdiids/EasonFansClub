import assert from 'node:assert'
import { readFileSync } from 'node:fs'

// 静态断言：表情包选择器入口图标必须 (1) 优先使用 coverUrl，(2) 封面为空时回退到该包第一张表情，
// (3) 不再因 iconUrl 而被第一张表情覆盖，(4) 图标尺寸移动端 28px / 桌面端 32px。
const lib = readFileSync(new URL('../components/StickerPicker.tsx', import.meta.url), 'utf8')

// 1. 入口图标优先使用封面 coverUrl
assert.match(lib, /packIcon = pack\.coverUrl/, '入口图标应优先使用 pack.coverUrl')

// 2. 封面为空时回退到该表情包第一张表情
assert.match(lib, /data\?\.stickersByPack\[pack\.id\]\?\.\[0\]\?\.url/, '封面为空时应回退到该表情包第一张表情')

// 3. 不再使用 iconUrl 作为图标来源（旧逻辑会覆盖封面）
assert.doesNotMatch(lib, /<img src=\{pack\.iconUrl\}/, '不应再使用 pack.iconUrl 作为入口图标')

// 4. 图标尺寸：移动端 28px (h-7 w-7)，桌面端 32px (sm:h-8 sm:w-8)
assert.match(lib, /h-7 w-7 flex-none[^"]*sm:h-8 sm:w-8/, '图标尺寸应为移动端 28px / 桌面端 32px')

// 5. 仍保持 object-cover 与 rounded
assert.match(lib, /className="h-full w-full object-cover"/, '图标应保持 object-cover 铺满')
