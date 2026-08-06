import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const page = read('app/checkin/page.tsx')
const surface = read('components/CheckInLayoutSurface.tsx')
const panel = read('components/CheckInMessagesPanel.tsx')
const adminRoute = read('app/api/admin/daily-messages/[messageId]/route.ts')

test('挂号页把当前用户角色透传到留言面板，仅管理员可见删除入口', () => {
  assert.match(page, /sessionUserRole=\{sessionUser\.role\}/)
  assert.match(surface, /sessionUserRole === 'ADMIN' \|\| sessionUserRole === 'SUPER_ADMIN'/)
  assert.match(surface, /canManageMessages=\{canManageMessages\}/)
  assert.match(panel, /canManageMessages && !previewMode && !isMinimal/)
  assert.match(panel, /aria-label="删除留言"/)
})

test('管理员删除必须先经过二次确认，确认后才调用既有管理接口', () => {
  assert.match(panel, /确认删除这条留言？/)
  assert.match(panel, /setDeleteTarget\(item\)/)
  assert.match(panel, /fetch\(`\/api\/admin\/daily-messages\/\$\{deleteTarget\.id\}`/)
  assert.match(panel, /isDeleted: true/)
  // 第一次点击不直接发请求：删除按钮 onClick 只打开确认框
  assert.ok(!panel.includes('onClick={() => void confirmDeleteMessage()}'))
})

test('删除按钮阻止冒泡，删除成功只局部移除目标留言', () => {
  const deleteButton = panel.indexOf('aria-label="删除留言"')
  const section = panel.slice(deleteButton, deleteButton + 400)
  assert.match(section, /event\.preventDefault\(\)/)
  assert.match(section, /event\.stopPropagation\(\)/)
  assert.match(panel, /current\.filter\(\(message\) => message\.id !== deleteTarget\.id\)/)
  // 删除路径不重置分页
  const confirmFn = panel.slice(panel.indexOf('async function confirmDeleteMessage'), panel.indexOf('async function confirmDeleteMessage') + 1500)
  assert.ok(!confirmFn.includes('setPage('))
})

test('删除接口服务端独立鉴权并对不存在留言返回 404', () => {
  assert.match(adminRoute, /requireAdmin\('daily_message_manage'\)/)
  assert.match(adminRoute, /留言不存在或已被删除/)
  assert.match(adminRoute, /status: 404/)
  // 软删除只作用于指定 id
  assert.match(adminRoute, /prisma\.dailyMessage\.update\(\{\s*where: \{ id: messageId \}/)
})

test('删除失败保留留言并显示中文错误', () => {
  assert.match(panel, /删除失败，请稍后重试/)
  assert.match(panel, /if \(!deleteTarget \|\| isDeletingMessage\) return/)
})
