import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const drawer = readFileSync('app/profile/ProfileEditorDrawer.tsx', 'utf8')

test('编辑资料 query 只负责一次性打开，清理 query 不会重置抽屉', () => {
  assert.match(drawer, /const editQueryConsumedRef = useRef\(false\)/)
  assert.match(drawer, /if \(!initialOpen\) \{[\s\S]*editQueryConsumedRef\.current = false/)
  assert.match(drawer, /if \(editQueryConsumedRef\.current\) return/)
  assert.match(drawer, /setIsOpen\(true\)/)
  assert.match(drawer, /window\.history\.replaceState/)
  assert.doesNotMatch(drawer, /setIsOpen\(initialOpen\)/)
})

test('编辑资料只通过明确的打开、关闭动作修改状态，不监听 resize/focus 自动关闭', () => {
  assert.match(drawer, /function openEditor\(\) \{[\s\S]*setIsOpen\(true\)/)
  assert.match(drawer, /const closeEditor = useCallback\(\(\) => \{[\s\S]*setIsOpen\(false\)/)
  assert.doesNotMatch(drawer, /addEventListener\(['"](?:resize|focusout|blur|visibilitychange|pointerdown|mousedown|click)['"]/)
})
