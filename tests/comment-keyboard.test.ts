import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { shouldSubmitCommentOnEnter } from '../lib/comment-keyboard'

const read = (path: string) => readFileSync(path, 'utf8')

test('桌面端普通 Enter 提交，Ctrl/Meta/Shift Enter 保留换行', () => {
  assert.equal(shouldSubmitCommentOnEnter({ key: 'Enter' }, { isDesktop: true, canSubmit: true }), true)
  assert.equal(shouldSubmitCommentOnEnter({ key: 'Enter', ctrlKey: true }, { isDesktop: true, canSubmit: true }), false)
  assert.equal(shouldSubmitCommentOnEnter({ key: 'Enter', metaKey: true }, { isDesktop: true, canSubmit: true }), false)
  assert.equal(shouldSubmitCommentOnEnter({ key: 'Enter', shiftKey: true }, { isDesktop: true, canSubmit: true }), false)
})

test('IME composing、229、空内容和提交中不会触发 Enter 提交', () => {
  assert.equal(shouldSubmitCommentOnEnter({ key: 'Enter', isComposing: true }, { isDesktop: true, canSubmit: true }), false)
  assert.equal(shouldSubmitCommentOnEnter({ key: 'Enter', nativeEvent: { isComposing: true } }, { isDesktop: true, canSubmit: true }), false)
  assert.equal(shouldSubmitCommentOnEnter({ key: 'Enter', keyCode: 229 }, { isDesktop: true, canSubmit: true }), false)
  assert.equal(shouldSubmitCommentOnEnter({ key: 'Enter', nativeEvent: { keyCode: 229 } }, { isDesktop: true, canSubmit: true }), false)
  assert.equal(shouldSubmitCommentOnEnter({ key: 'Enter' }, { isDesktop: true, canSubmit: false }), false)
  assert.equal(shouldSubmitCommentOnEnter({ key: 'Enter' }, { isDesktop: false, canSubmit: true }), false)
})

test('帖子回复和通知回复复用同一键盘规则，移动端不套用桌面快捷发送', () => {
  const friendInput = read('components/FriendMentionInput.tsx')
  const replyForm = read('components/ReplyForm.tsx')
  const notificationComposer = read('components/NotificationReplyComposer.tsx')
  const mediaQueryHook = read('lib/use-desktop-media-query.ts')

  assert.match(friendInput, /shouldSubmitCommentOnEnter\(event, \{/)
  assert.match(friendInput, /isDesktop,/)
  assert.match(friendInput, /canSubmit: canSubmitShortcut/)
  assert.match(replyForm, /onSubmitShortcut=\{\(\) => void submitReply\(\)\}/)
  assert.match(replyForm, /canSubmitShortcut=\{!isSubmitting/)
  assert.match(notificationComposer, /shouldSubmitCommentOnEnter\(event, \{ isDesktop, canSubmit: canSubmitShortcut \}\)/)
  assert.match(notificationComposer, /onClick=\{\(\) => void submit\(\)\}/)
  assert.match(mediaQueryHook, /matchMedia\('\(min-width: 768px\)'\)/)
  assert.doesNotMatch(friendInput, /event\.ctrlKey[\s\S]*onSubmitShortcut/)
})
