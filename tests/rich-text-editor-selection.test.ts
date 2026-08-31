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

test('heading menu is opened only by a user trigger and closes after selection', () => {
  const editorContentStart = editor.indexOf('<EditorContent')
  const editorContentEnd = editor.indexOf('/>', editorContentStart)
  const editorContent = editor.slice(editorContentStart, editorContentEnd + 2)

  assert.match(editor, /const \[headingMenuOpen, setHeadingMenuOpen\] = useState\(false\)/u)
  assert.match(editor, /const headingMenuOpenRef = useRef\(false\)/u)
  assert.match(editor, /const currentBlockType: 'paragraph' \| HeadingLevel = activeHeadingLevel \?\? 'paragraph'/u)
  assert.match(editor, /function toggleHeadingMenuFromUser\(\)/u)
  assert.match(editor, /function handleHeadingTriggerPointerDown\(event: ReactPointerEvent<HTMLButtonElement>\)/u)
  assert.match(editor, /if \(event\.button !== 0\) return/u)
  assert.match(editor, /function handleHeadingTriggerKeyDown\(event: ReactKeyboardEvent<HTMLButtonElement>\)/u)
  assert.match(editor, /event\.nativeEvent\.isComposing \|\| event\.nativeEvent\.keyCode === 229/u)
  assert.match(editor, /event\.key !== 'Enter' && event\.key !== ' ' && event\.key !== 'ArrowDown'/u)
  assert.match(editor, /onPointerDown=\{handleHeadingTriggerPointerDown\}/u)
  assert.match(editor, /onKeyDown=\{handleHeadingTriggerKeyDown\}/u)
  assert.doesNotMatch(editor, /onClick=\{toggleHeadingMenu\}/u)
  assert.doesNotMatch(editor, /setHeadingMenuOpen\(\s*true\s*\)/u)
  assert.match(editor, /headingMenuOpen \? \(/u)
  assert.match(editor, /aria-controls="rich-text-heading-menu"/u)
  assert.match(editor, /id="rich-text-heading-menu"/u)
  assert.match(editor, /document\.addEventListener\('keydown'/u)
  assert.match(editor, /event\.key !== 'Escape'/u)
  assert.doesNotMatch(editorContent, /onPointerDown=\{closeToolbarMenus\}/u)
  assert.doesNotMatch(editorContent, /onMouseDown=\{closeToolbarMenus\}/u)
  assert.match(editorContent, /onFocus=\{closeToolbarMenus\}/u)
  assert.match(editorContent, /onBlur=\{closeToolbarMenus\}/u)
  assert.match(editorContent, /onCompositionStart=\{closeToolbarMenus\}/u)
  assert.match(editor, /function toggleToolbarMenu\(menu: 'size' \| 'color'\)/u)
  assert.match(editor, /setOpenMenu\(\(current\) => current === menu \? null : menu\)/u)
  assert.match(editor, /function applyBlock\(/u)
  assert.match(editor, /setOpenMenu\(null\)/u)
  assert.match(editor, /onSelectionUpdate: \(\{ editor: selectedEditor \}\) => syncEditorSelection\(selectedEditor\)/u)
  assert.doesNotMatch(editor, /onSelectionUpdate:[^\n]*setHeadingMenuOpen/u)
  assert.match(editor, /const rememberToolbarPointerDown = \(event: ReactPointerEvent<HTMLButtonElement>\) => \{\s*rememberSelection\(activeEditor\)\s*event\.preventDefault\(\)/u)
  assert.match(editor, /onPointerDown=\{rememberToolbarPointerDown\}/u)
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
  assert.doesNotMatch(editor, /ToggleGroup|type=['"]single['"]|activeFormat|selectedFormat|aria-selected/u)
})

test('editor input does not reconfigure the view or focus-scroll as a side effect', () => {
  assert.match(editor, /import[\s\S]*useMemo[\s\S]*from 'react'/u)
  assert.match(editor, /const editorProps = useMemo\(\(\) => \(\{/u)
  assert.match(editor, /editorProps,/u)
  assert.match(editor, /function focusEditorWithoutScroll\(editor: Editor\)/u)
  assert.match(editor, /editor\.view\.focus\(\)/u)
  assert.doesNotMatch(editor, /onTransaction:\s*\(\) => setToolbarVersion/u)
  assert.doesNotMatch(editor, /\.chain\(\)\.focus\(/u)
  assert.doesNotMatch(editor, /scrollIntoView|scrollTo\(|scrollTop|window\.scroll/u)
})

test('forms keep the editor and toolbar outside label activation behavior', () => {
  const createForm = readFileSync('components/PostCreateForm.tsx', 'utf8')
  const editForm = readFileSync('components/PostEditForm.tsx', 'utf8')
  const editorLabelPattern = /<label className="block">\s*<span className="text-sm font-black text-slate-700">正文<\/span>[\s\S]*?<RichTextEditor/u
  const editorGroupPattern = /<div className="block">\s*<span className="text-sm font-black text-slate-700">正文<\/span>[\s\S]*?<RichTextEditor/u
  assert.doesNotMatch(createForm, editorLabelPattern)
  assert.doesNotMatch(editForm, editorLabelPattern)
  assert.match(createForm, editorGroupPattern)
  assert.match(editForm, editorGroupPattern)
})

test('music insertion uses the saved selection rather than forcing the document start or end', () => {
  assert.match(editor, /function insertMusicReference\(song: MusicReferenceSong\)/u)
  assert.match(editor, /startCommand\(\)[\s\S]*type: 'musicReference'/u)
  assert.doesNotMatch(editor, /focus\(['"]start['"]\)|focus\(['"]end['"]\)|setSelection\(0\)/u)
})
