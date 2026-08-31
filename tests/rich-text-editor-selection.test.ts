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
  assert.match(editor, /const \[headingMenuOpen, setHeadingMenuOpen\] = useState\(false\)/u)
  assert.match(editor, /const currentBlockType: 'paragraph' \| 1 \| 2 \| 3 = activeHeading \?\? 'paragraph'/u)
  assert.match(editor, /function toggleHeadingMenu\(\)/u)
  assert.match(editor, /setHeadingMenuOpen\(\(current\) => !current\)/u)
  assert.match(editor, /onClick=\{toggleHeadingMenu\}/u)
  assert.match(editor, /headingMenuOpen \? \(/u)
  assert.match(editor, /document\.addEventListener\('keydown'/u)
  assert.match(editor, /event\.key !== 'Escape'/u)
  assert.match(editor, /onPointerDown=\{closeToolbarMenus\}/u)
  assert.match(editor, /onFocus=\{closeToolbarMenus\}/u)
  assert.match(editor, /onBlur=\{closeToolbarMenus\}/u)
  assert.match(editor, /onCompositionStart=\{closeToolbarMenus\}/u)
  assert.match(editor, /function toggleToolbarMenu\(menu: 'size' \| 'color'\)/u)
  assert.match(editor, /setOpenMenu\(\(current\) => current === menu \? null : menu\)/u)
  assert.match(editor, /function applyBlock\(/u)
  assert.match(editor, /setOpenMenu\(null\)/u)
  assert.match(editor, /onSelectionUpdate: \(\{ editor: selectedEditor \}\) => rememberSelection\(selectedEditor\)/u)
  assert.doesNotMatch(editor, /onSelectionUpdate:[^\n]*setHeadingMenuOpen/u)
  assert.match(editor, /onMouseDown=\{closeHeadingOnToolbarMouseDown\}/u)
})

test('bold, italic and strike are real toggles with selection-sourced active state', () => {
  assert.match(editor, /function toggleInlineMark\(mark: 'bold' \| 'italic' \| 'strike'\)/u)
  assert.match(editor, /if \(mark === 'bold'\) \{\s*command\.toggleBold\(\)\.run\(\)/u)
  assert.match(editor, /if \(mark === 'italic'\) \{[\s\S]*command\.toggleMark\('italic'\)\.run\(\)/u)
  assert.match(editor, /command\.toggleMark\('strike'\)\.run\(\)/u)
  assert.match(editor, /toolbarButtonClass\(activeEditor\.isActive\('bold'\)\)/u)
  assert.match(editor, /toolbarButtonClass\(activeEditor\.isActive\('italic'\)\)/u)
  assert.match(editor, /toolbarButtonClass\(activeEditor\.isActive\('strike'\)\)/u)
  assert.match(editor, /aria-pressed=\{activeEditor\.isActive\('bold'\)\}/u)
  assert.match(editor, /aria-pressed=\{activeEditor\.isActive\('italic'\)\}/u)
  assert.match(editor, /aria-pressed=\{activeEditor\.isActive\('strike'\)\}/u)
  assert.match(editor, /onClick=\{\(\) => toggleInlineMark\('bold'\)\}/u)
  assert.match(editor, /onClick=\{\(\) => toggleInlineMark\('italic'\)\}/u)
  assert.match(editor, /onClick=\{\(\) => toggleInlineMark\('strike'\)\}/u)
  assert.doesNotMatch(editor, /setBold\(|setItalic\(|setStrike\(|addMark\(/u)
})

test('music insertion uses the saved selection rather than forcing the document start or end', () => {
  assert.match(editor, /function insertMusicReference\(song: MusicReferenceSong\)/u)
  assert.match(editor, /startCommand\(\)[\s\S]*type: 'musicReference'/u)
  assert.doesNotMatch(editor, /focus\(['"]start['"]\)|focus\(['"]end['"]\)|setSelection\(0\)/u)
})
