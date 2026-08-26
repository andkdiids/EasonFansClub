import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const dock = read('components/FriendDock.tsx')
const dialog = read('components/FriendGroupDialog.tsx')
const styles = read('app/globals.css')
const createRoute = read('app/api/friend-groups/route.ts')
const detailRoute = read('app/api/friend-groups/[groupId]/route.ts')
const schema = read('prisma/schema.prisma')

test('好友分组管理不再使用浏览器原生 prompt/confirm', () => {
  const groupHandlers = dock.slice(dock.indexOf('function openFriendGroupDialog'), dock.indexOf('async function moveFriendToGroup'))
  assert.doesNotMatch(groupHandlers, /window\.(prompt|alert|confirm)|\b(prompt|alert|confirm)\(/)
  assert.match(dock, /<FriendGroupDialog/)
  assert.match(dock, /<ConfirmDialog[\s\S]*title="删除分组？"/)
  assert.match(dock, /onClick=\{\(\) => openFriendGroupDialog\('create'\)\}/)
  assert.match(dock, /onClick=\{\(\) => openFriendGroupDialog\('rename', group\)\}/)
})

test('分组表单使用站内 submit、30 字符限制并兼容中文输入法', () => {
  assert.match(dialog, /<form className="friend-group-dialog-form" onSubmit=\{onSubmit\}>/)
  assert.match(dialog, /maxLength=\{30\}/)
  assert.match(dialog, /type="button" onClick=\{onCancel\}/)
  assert.match(dialog, /type="submit" disabled=\{busy \|\| !name\.trim\(\)/)
  assert.match(dock, /event\.nativeEvent\.isComposing/)
  assert.match(dock, /friendGroupDialogComposingRef/)
  assert.match(dialog, /window\.history\.pushState/)
  assert.match(dialog, /window\.addEventListener\('popstate'/)
  assert.match(styles, /friend-group-dialog-form > input[\s\S]*font-size:16px/)
  assert.match(styles, /friend-group-dialog-backdrop[\s\S]*z-index:calc\(var\(--layer-dialog\) \+ 1\)/)
  assert.match(styles, /max-height:min\(90dvh,calc\(100dvh - 8px\)\)/)
  assert.match(styles, /env\(safe-area-inset-bottom,0px\)/)
})

test('创建/重命名失败保留表单状态，成功后只更新本地分组列表', () => {
  assert.match(dock, /credentials: 'same-origin'/)
  assert.match(dock, /cache: 'no-store'/)
  assert.match(dock, /setFriendGroupDialogError\(data\.message \|\|/)
  assert.match(dock, /setFriendGroups\(\(current\) => current\.some\(/)
  assert.match(dock, /setFriendGroupDialog\(null\)/)
  assert.match(dock, /friendGroupDialogSubmittingRef\.current = true/)
  assert.match(dock, /friendGroupDialogSubmittingRef\.current = false/)
})

test('分组 API 从 session 取得 owner，并由服务端校验名称与同名唯一性', () => {
  assert.match(createRoute, /const guard = await requireUser\(\)/)
  assert.match(createRoute, /data: \{ ownerId: user\.id, name: parsed\.name/)
  assert.match(createRoute, /FRIEND_GROUP_NAME_MAX_LENGTH = 30/)
  assert.match(createRoute, /error\.code === 'P2002'/)
  assert.match(detailRoute, /where: \{ id: groupId, ownerId: user\.id \}/)
  assert.match(schema, /@@unique\(\[ownerId, name\]\)/)
})
