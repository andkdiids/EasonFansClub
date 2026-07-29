import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const picker = read('components/EmojiPicker.tsx')
const css = read('app/globals.css')

test('统一 EmojiPicker 提供六类且至少 100 个不同 Unicode Emoji', () => {
  assert.equal((picker.match(/label: '/g) || []).length, 6)
  const emojis = new Set([...picker.matchAll(/'([^']*\p{Extended_Pictographic}[^']*)'/gu)].map((match) => match[1]))
  assert.ok(emojis.size >= 100, `expected at least 100 unique emoji, received ${emojis.size}`)
  for (const emoji of ['😀', '❤️', '👍', '🐱', '🎤', '🚑', '🥳']) {
    assert.ok(emojis.has(emoji))
  }
})

test('EmojiPicker 在当前光标插入并在选择后恢复焦点', () => {
  assert.match(picker, /const start = input\?\.selectionStart \?\? value\.length/)
  assert.match(picker, /const end = input\?\.selectionEnd \?\? value\.length/)
  assert.match(picker, /value\.slice\(0, start\).*emoji.*value\.slice\(end\)/)
  assert.match(picker, /input\?\.setSelectionRange\(cursor, cursor\)/)
})

test('Emoji 面板可滚动、靠近输入框且移动端不超过可用内容宽度', () => {
  assert.match(css, /\.emoji-picker-panel \{[^}]*bottom:calc\(100% \+ 8px\);[^}]*width:min\(320px,calc\(100vw - 48px\)\);[^}]*overflow-y:auto;[^}]*padding:10px 10px max\(10px,env\(safe-area-inset-bottom\)\)/)
  assert.match(css, /\.friend-chat-composer \.emoji-picker-panel \{ width:calc\(80vw - 24px\); max-width:396px; \}/)
})

test('私信、帖子、评论回复、每日挂号与挂号留言全部复用唯一 EmojiPicker', () => {
  for (const path of [
    'components/FriendDock.tsx',
    'components/PostCreateForm.tsx',
    'components/ReplyForm.tsx',
    'components/CheckInButton.tsx',
    'components/DailyMessageActions.tsx',
  ]) {
    const source = read(path)
    assert.match(source, /import \{ EmojiPicker \} from '@\/components\/EmojiPicker'/)
    assert.match(source, /<EmojiPicker textareaRef=/)
    assert.doesNotMatch(source, /EmojiButton/)
  }
})
