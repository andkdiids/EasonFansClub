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
  assert.match(editor, /onPointerDown=\{rememberToolbarPointerDown\}/u)
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
  assert.match(editor, /function toggleToolbarMenu\(menu: 'list' \| 'size' \| 'color'\)/u)
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
  assert.match(editor, /activeEditor\.chain\(\)\.focus\(null, \{ scrollIntoView: false \}\)\.toggleBold\(\)\.run\(\)/u)
  assert.match(editor, /activeEditor\.chain\(\)\.focus\(null, \{ scrollIntoView: false \}\)\.toggleItalic\(\)\.run\(\)/u)
  assert.match(editor, /activeEditor\.chain\(\)\.focus\(null, \{ scrollIntoView: false \}\)\.toggleStrike\(\)\.run\(\)/u)
  assert.match(editor, /const \{\s*bold: boldActive,\s*italic: italicActive,\s*strike: strikeActive,?[\s\S]*\} = inlineMarkState/u)
  assert.match(editor, /data-active=\{boldActive \? 'true' : 'false'\}/u)
  assert.match(editor, /data-active=\{italicActive \? 'true' : 'false'\}/u)
  assert.match(editor, /data-active=\{strikeActive \? 'true' : 'false'\}/u)
  assert.match(editor, /const inlineMarkEditorEvents = \['selectionUpdate', 'transaction', 'update', 'focus', 'blur'\]/u)
  assert.match(editor, /editor\.isActive\('bold'\)/u)
  assert.match(editor, /editor\.isActive\('italic'\)/u)
  assert.match(editor, /editor\.isActive\('strike'\)/u)
  assert.match(editor, /toggleItalic:.*commands\.toggleMark\('italic'\)/u)
  assert.match(editor, /toggleStrike:.*commands\.toggleMark\('strike'\)/u)
  assert.match(editor, /onClick=\{\(\) => toggleInlineMark\('bold'\)\}/u)
  assert.match(editor, /onClick=\{\(\) => toggleInlineMark\('italic'\)\}/u)
  assert.match(editor, /onClick=\{\(\) => toggleInlineMark\('strike'\)\}/u)
  assert.doesNotMatch(editor, /setBold\(|setItalic\(|setStrike\(|addMark\(/u)
  assert.doesNotMatch(editor, /toggleMark\('italic'\)\.run\(|toggleMark\('strike'\)\.run\(/u)
  assert.doesNotMatch(editor, /ToggleGroup|type=['"]single['"]|activeFormat|selectedFormat|aria-selected/u)
})

test('inline mark state is independent, reactive, and does not reset the caret stored marks', () => {
  assert.match(editor, /type InlineMarkToolbarState = Readonly<\{\s*bold: boolean\s*italic: boolean\s*strike: boolean/u)
  assert.match(editor, /function useInlineMarkToolbarState\(editor: Editor \| null\)/u)
  assert.match(editor, /inlineMarkEditorEvents\.forEach\(\(eventName\) => editor\.on\(eventName, listener\)\)/u)
  assert.match(editor, /inlineMarkEditorEvents\.forEach\(\(eventName\) => editor\.off\(eventName, listener\)\)/u)
  assert.match(editor, /const currentSelection = activeEditor\.state\.selection\s*if \(currentSelection\.from === from && currentSelection\.to === to\) return/u)
  assert.match(editor, /onPointerDown=\{rememberToolbarPointerDown\}/u)
})

test('toolbar focus styling cannot masquerade as an active inline mark', () => {
  const css = readFileSync('app/globals.css', 'utf8')
  assert.match(css, /\.rich-text-toolbar-button\[data-active='true'\]/u)
  assert.match(css, /\.rich-text-toolbar-button:focus-visible\s*\{[^}]*outline:/u)
  assert.doesNotMatch(css, /\.rich-text-toolbar-button:focus\s*\{[^}]*background:/u)
})

test('editor input does not reconfigure the view or focus-scroll as a side effect', () => {
  assert.match(editor, /import[\s\S]*useMemo[\s\S]*from 'react'/u)
  assert.match(editor, /const editorProps = useMemo\(\(\) => \(\{/u)
  assert.match(editor, /editorProps,/u)
  assert.match(editor, /function focusEditorWithoutScroll\(editor: Editor\)/u)
  assert.match(editor, /editor\.view\.focus\(\)/u)
  assert.doesNotMatch(editor, /onTransaction:\s*\(\) => setToolbarVersion/u)
  assert.match(editor, /\.chain\(\)\.focus\(null, \{ scrollIntoView: false \}\)/u)
  assert.doesNotMatch(editor, /scrollTo\(|scrollTop|window\.scroll/u)
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

test('list backspace delegates non-empty selections to the base keymap', () => {
  assert.match(editor, /if \(!this\.editor\.state\.selection\.empty\) return false/u)
  assert.match(editor, /isEmptyListItemAtStart\(this\.editor\)/u)
})
