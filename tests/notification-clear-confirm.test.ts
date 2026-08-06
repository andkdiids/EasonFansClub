import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const client = read('app/notifications/NotificationsClient.tsx')
const dialog = read('components/ConfirmDialog.tsx')

test('单条清除与清除全部都必须先经过二次确认弹窗', () => {
  assert.match(client, /确认清除这条通知？/)
  assert.match(client, /确认清除全部通知？/)
  // 按钮第一次点击只打开确认框，不直接调用删除
  assert.ok(!client.includes('onClick={() => void clearNotifications'))
  assert.match(client, /setClearConfirm\(\{[\s\S]*items: \[item\]/)
  assert.match(client, /<ConfirmDialog/)
  assert.match(client, /onConfirm=\{\(\) => void confirmClearNotifications\(\)\}/)
})

test('单条清除按钮阻止冒泡与默认行为，不触发通知跳转', () => {
  const clearButton = client.indexOf('aria-label="清除这条通知"')
  assert.ok(clearButton > 0)
  const section = client.slice(clearButton, clearButton + 400)
  assert.match(section, /event\.preventDefault\(\)/)
  assert.match(section, /event\.stopPropagation\(\)/)
})

test('清除请求中防止重复提交，失败保留数据并提示错误', () => {
  assert.match(client, /if \(!clearConfirm \|\| isClearing\) return/)
  assert.match(client, /loading=\{isClearing\}/)
  assert.match(client, /清除失败，请稍后重试/)
  // 删除接口失败时不修改本地列表
  assert.match(client, /if \(!response\.ok\) return false/)
})

test('删除未读通知时本地未读数立即减少且不出现负数', () => {
  assert.match(client, /decrementUnreadSummary\(current \|\| sharedSummary, items\)/)
  assert.match(client, /Math\.max\(0, next\.total - 1\)/)
})

test('同一条通知已读请求去重，未读数不会重复扣减', () => {
  assert.match(client, /markingReadRef\.current\.has\(itemKey\)\) return true/)
  assert.match(client, /markingReadRef\.current\.delete\(itemKey\)/)
})

test('确认弹窗默认焦点在取消、支持 Esc 与遮罩关闭、请求中禁止关闭', () => {
  assert.match(dialog, /cancelRef\.current\?\.focus\(\)/)
  assert.match(dialog, /event\.key === 'Escape' && !loading/)
  assert.match(dialog, /if \(!loading\) onCancel\(\)/)
  assert.match(dialog, /role="dialog"/)
  assert.match(dialog, /aria-modal="true"/)
})
