import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const dock = read('components/FriendDock.tsx')
const picker = read('components/StickerPicker.tsx')
const css = read('app/globals.css')

const sendSticker = dock.match(/function sendSticker\(sticker: PickerSticker\)[\s\S]*?\n  }\n\n  async function recallMessage/)?.[0] || ''
const submitMessage = dock.match(/function submitMessage\(event\?: FormEvent<HTMLFormElement>\)[\s\S]*?async function loadOlderMessages/)?.[0] || ''
const sendMessage = dock.match(/async function sendMessage\(input:[\s\S]*?\n  }\n\n  function sendSticker/)?.[0] || ''

test('sticker sends use an explicit source, blur before closing, and preserve the text draft', () => {
  assert.match(dock, /type ComposerSendSource = 'text' \| 'sticker' \| 'image' \| 'card' \| 'link' \| 'other'/)
  assert.match(sendMessage, /source: ComposerSendSource/)
  assert.match(sendSticker, /blurComposerForStickerSend\(\)[\s\S]*setPickerOpen\(false\)/)
  assert.match(sendSticker, /setPickerOpen\(false\)[\s\S]*settleStickerSendFocus\(\)/)
  assert.match(sendSticker, /source: 'sticker'/)
  assert.doesNotMatch(sendSticker, /setContent\(/)
})

test('text sends keep their existing source and draft-clearing behavior', () => {
  assert.match(submitMessage, /sendMessage\(\{ content: trimmed, clientMessageId, source: 'text' \}\)/)
  assert.match(submitMessage, /if \(success\) setContent\(\(current\) => current\.trim\(\) === trimmed \? '' : current\)/)
  assert.doesNotMatch(submitMessage, /source: 'text'[\s\S]*blurComposerForStickerSend/)
})

test('a late focus can only be accepted after an explicit composer pointer action', () => {
  assert.match(dock, /const composerFocusIntentRef = useRef\(false\)/)
  assert.match(dock, /onPointerDown=\{\(\) => \{[\s\S]*composerFocusIntentRef\.current = true/)
  assert.match(dock, /if \(stickerSendFocusGuardRef\.current && !composerFocusIntentRef\.current\)/)
  assert.match(dock, /messageInputRef\.current\?\.blur\(\)[\s\S]*return/)
  assert.match(dock, /stickerSendFocusGuardRef\.current = false/)
})

test('message updates do not globally refocus the composer, while sticker completion settles focus and scrolls latest', () => {
  assert.match(sendMessage, /if \(input\.source === 'sticker'\) blurComposerForStickerSend\(\)/)
  assert.match(sendMessage, /if \(input\.source === 'sticker'\) settleStickerSendFocus\(\)/)
  assert.match(dock, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*messageInputRef\.current\?\.blur\(\)[\s\S]*scrollToBottom\('smooth'\)/)
  assert.doesNotMatch(dock, /useEffect\([\s\S]*setMessages\([\s\S]*messageInputRef\.current\?\.focus\(/)
})

test('the picker is inline rather than a focus-managed popover, and viewport recovery remains event-driven', () => {
  assert.doesNotMatch(picker, /onCloseAutoFocus|onOpenAutoFocus/)
  assert.match(picker, /absolute inset-x-0 bottom-full/)
  assert.match(dock, /window\.visualViewport\?\.addEventListener\('resize', update\)/)
  assert.match(dock, /window\.visualViewport\?\.addEventListener\('scroll', update\)/)
  assert.match(dock, /window\.visualViewport\?\.removeEventListener\('resize', update\)/)
  assert.match(dock, /window\.visualViewport\?\.removeEventListener\('scroll', update\)/)
  assert.match(css, /\.friend-chat-messages \{[^}]*overflow-y:auto/)
  assert.match(css, /--friend-dock-viewport-height,100dvh/)
})
