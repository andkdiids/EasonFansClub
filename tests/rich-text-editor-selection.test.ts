import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const editor = readFileSync('components/posts/RichTextEditor.tsx', 'utf8')

test('editor keeps one initial document instead of rehydrating on each parent text update', () => {
  assert.match(editor, /const \[initialDocument\] = useState\(\(\) => initialEditorContent\(/u)
  assert.doesNotMatch(editor, /const initialDocument = useMemo\(/u)
})

test('editor records and restores the actual caret/range before toolbar commands', () => {
  assert.match(editor, /const savedSelectionRef = useRef/u)
  assert.match(editor, /onSelectionUpdate:/u)
  assert.match(editor, /activeEditor\.commands\.setTextSelection\(\{ from, to \}\)/u)
  assert.match(editor, /function startCommand\(\)/u)
  assert.match(editor, /rememberSelection\(activeEditor\)/u)
  assert.match(editor, /onMouseDown=\{stopToolbarBlur\}/u)
})

test('heading menu is opened only by its explicit trigger and closes after selection', () => {
  assert.match(editor, /function toggleToolbarMenu\(menu: 'block' \| 'size' \| 'color'\)/u)
  assert.match(editor, /setOpenMenu\(\(current\) => current === menu \? null : menu\)/u)
  assert.match(editor, /onClick=\{\(\) => toggleToolbarMenu\('block'\)\}/u)
  assert.match(editor, /function applyBlock\(/u)
  assert.match(editor, /setOpenMenu\(null\)/u)
  assert.doesNotMatch(editor, /onSelectionUpdate:[\s\S]{0,180}setOpenMenu/u)
})

test('music insertion uses the saved selection rather than forcing the document start or end', () => {
  assert.match(editor, /function insertMusicReference\(song: MusicReferenceSong\)/u)
  assert.match(editor, /startCommand\(\)[\s\S]*type: 'musicReference'/u)
  assert.doesNotMatch(editor, /focus\(['"]start['"]\)|focus\(['"]end['"]\)|setSelection\(0\)/u)
})
