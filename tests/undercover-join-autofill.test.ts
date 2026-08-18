import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const entrySource = readFileSync(
  new URL('../components/games/undercover-star/UndercoverEntryPanel.tsx', import.meta.url),
  'utf8',
)

const lines = entrySource.split('\n')

test('加入房间表单禁止浏览器自动填充并隔离账号信息', () => {
  // 1) 表单层关闭自动填充
  assert.match(entrySource, /<form[^>]*\bonSubmit=\{onJoin\}[^>]*\bautoComplete="off"/, 'join 表单必须设置 autoComplete="off"')

  // 2) 房间号 / 密码使用非通用 name，避免被识别为通用 password/code 字段
  assert.match(entrySource, /\bname="uc-join-room-code"/, '房间号 input 须使用非通用 name')
  assert.match(entrySource, /\bname="uc-join-room-password"/, '房间密码 input 须使用非通用 name')

  // 3) 不得出现会引发账号自动填充的通用 name
  assert.doesNotMatch(
    entrySource,
    /\bname=("|')(password|passwd|pwd|code|room|username|email)("|')/,
    '不得出现通用 name 触发账号自动填充',
  )

  // 4) 房间密码框使用 new-password，避免浏览器填入账号密码（按行匹配，避免箭头函数 => 中的 > 干扰）
  const passwordLine = lines.find((line) => line.includes('type="password"'))
  assert.ok(passwordLine, '必须存在房间密码 input')
  assert.match(passwordLine, /name="uc-join-room-password"/, '密码 input 须使用非通用 name')
  assert.match(passwordLine, /autoComplete="new-password"/, '密码 input 必须设置 autoComplete="new-password"')
})
