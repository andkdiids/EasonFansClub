import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const panel = readFileSync('components/music/live/AttendancePanel.tsx', 'utf8')

test('观演记录编辑表单保留三个独立的受控字段', () => {
  assert.match(panel, /value=\{form\.seatInfo\}[\s\S]*onChange=\{\(event\) => setForm\(\{ \.\.\.form, seatInfo: event\.target\.value \}\)\}/)
  assert.match(panel, /value=\{form\.mood\}[\s\S]*onChange=\{\(event\) => setForm\(\{ \.\.\.form, mood: event\.target\.value \}\)\}/)
  assert.match(panel, /value=\{form\.note\}[\s\S]*onChange=\{\(event\) => setForm\(\{ \.\.\.form, note: event\.target\.value \}\)\}/)
  assert.match(panel, /body: JSON\.stringify\(attendance \? \{ \.\.\.form, updatedAt: attendance\.updatedAt \} : form\)/)
  assert.match(panel, /seatInfo: data\.attendance\.seatInfo \|\| ''[\s\S]*mood: data\.attendance\.mood \|\| ''[\s\S]*note: data\.attendance\.note \|\| ''/)
})

test('初始化焦点只在弹窗打开时执行，不随 dirty 或 requestClose 变化重跑', () => {
  const focusEffect = panel.match(/useEffect\(\(\) => \{\s*if \(!open\) return[\s\S]*?firstInputRef\.current\?\.focus\(\{ preventScroll: true \}\)[\s\S]*?\}, \[open\]\)/)
  assert.ok(focusEffect, '打开弹窗时应保留一次性初始焦点')
  assert.doesNotMatch(focusEffect[0], /dirty|requestClose|form/)
  assert.doesNotMatch(focusEffect[0], /setTimeout|requestAnimationFrame|scrollIntoView/)
  assert.match(panel, /window\.addEventListener\('keydown', onKeyDown\)[\s\S]*?\}, \[open, requestClose\]\)/)
})

test('普通字段输入不会导致表单节点通过 key 或 autoFocus 重新挂载', () => {
  assert.doesNotMatch(panel, /\bkey\s*=\s*\{/)
  assert.doesNotMatch(panel, /\bautoFocus\b/)
  assert.doesNotMatch(panel, /onChange=\{\(event\) => \{[\s\S]*?focus\(/)
})

test('座位信息只作为打开编辑时的初始焦点，用户仍可主动切换到其他字段', () => {
  assert.match(panel, /座位信息（选填）<input ref=\{firstInputRef\}/)
  assert.match(panel, /当晚心情（选填）<input value=\{form\.mood\}/)
  assert.match(panel, /个人笔记（选填）<textarea value=\{form\.note\}/)
  assert.match(panel, /firstInputRef\.current\?\.focus\(\{ preventScroll: true \}\)/)
})

test('中文输入法组合事件不会触发 blur、focus 或滚动，输入仍写入受控状态', () => {
  assert.doesNotMatch(panel, /onComposition(?:Start|Update|End)=/)
  assert.doesNotMatch(panel, /on(?:Input|Change)=\{[\s\S]*?(?:blur|focus|scrollIntoView)\(/)
  assert.match(panel, /value=\{form\.mood\}[\s\S]*setForm\(\{ \.\.\.form, mood: event\.target\.value \}\)/)
  assert.match(panel, /value=\{form\.note\}[\s\S]*setForm\(\{ \.\.\.form, note: event\.target\.value \}\)/)
})
