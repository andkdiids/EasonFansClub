import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const editor = readFileSync('components/posts/RichTextEditor.tsx', 'utf8')
const css = readFileSync('app/globals.css', 'utf8')
const richTextCssStart = css.indexOf('.rich-text-editor-shell')
const mobileCssStart = css.indexOf('@media (max-width: 640px)', richTextCssStart)
const mobileCss = css.slice(mobileCssStart, mobileCssStart + 3200)

test('mobile rich-text toolbar exposes the two requested rows without desktop duplication', () => {
  const primaryStart = editor.indexOf('rich-text-toolbar-row-primary')
  const secondaryStart = editor.indexOf('rich-text-toolbar-row-secondary')
  assert.ok(primaryStart >= 0)
  assert.ok(secondaryStart > primaryStart)

  const primary = editor.slice(primaryStart, secondaryStart)
  const secondary = editor.slice(secondaryStart)

  for (const marker of [
    'aria-controls="rich-text-heading-menu"',
    '字号',
    'rich-text-color-trigger',
    'aria-label="加粗"',
    'aria-label="斜体"',
    'aria-label="删除线"',
    'aria-label="列表"',
  ]) {
    assert.ok(primary.includes(marker), `primary row is missing ${marker}`)
  }

  for (const marker of [
    'aria-label="引用一篇站内帖子"',
    'aria-label="@用户"',
    'aria-label="插入分割线"',
    'aria-label="引用 EasMusic 歌曲"',
    '清除格式',
    'aria-label="撤销"',
    'aria-label="重做"',
  ]) {
    assert.ok(secondary.includes(marker), `secondary row is missing ${marker}`)
  }

  assert.match(css, /\.rich-text-toolbar-row \{ display: contents; \}/u)
  assert.match(css, /\.rich-text-toolbar-row-primary \{ z-index: 3; \}/u)
  assert.match(css, /\.rich-text-toolbar-row-secondary \{ z-index: 1; gap: 2px; \}/u)
  assert.match(css, /\.rich-text-editor-shell \{ position: relative;[^}]*isolation: isolate;[^}]*overflow: visible;/u)
  assert.match(css, /\.rich-text-editor-content \{ position: relative; z-index: 0;[^}]*overflow: visible; \}/u)

  assert.match(mobileCss, /\.rich-text-toolbar \{[^}]*display: grid;[^}]*grid-template-rows: repeat\(2, auto\);[^}]*overflow: visible;/u)
  assert.doesNotMatch(mobileCss, /overflow-x:\s*auto/u)
  assert.match(mobileCss, /\.rich-text-editor-shell \{ margin-inline: -16px; \}/u)
  assert.match(mobileCss, /\.rich-text-toolbar-row \{[^}]*display: flex;[^}]*flex-wrap: nowrap;[^}]*overflow: visible;/u)
  assert.match(mobileCss, /\.rich-text-toolbar-row-primary \{ z-index: 3; \}/u)
  assert.match(mobileCss, /\.rich-text-toolbar-row-secondary \{ z-index: 1; gap: 2px; \}/u)
  assert.match(mobileCss, /\.rich-text-toolbar-button \{[^}]*font-size: clamp\(10px, 2\.8vw, 11px\);[^}]*white-space: normal;/u)
  assert.match(mobileCss, /\.rich-text-toolbar-row-secondary > \.rich-text-toolbar-button,[\s\S]*?flex: 1 1 0; width: 0;/u)
  assert.match(mobileCss, /\.rich-text-toolbar-menu \{[^}]*max-width: calc\(100vw - 16px\);[^}]*max-height: min\(60dvh, 360px\);[^}]*overflow-y: auto;/u)
  assert.match(mobileCss, /\.rich-text-toolbar-dropdown-heading \.rich-text-toolbar-menu, \.rich-text-toolbar-dropdown-size \.rich-text-toolbar-menu \{[^}]*right: auto; left: 0; \}/u)
  assert.match(mobileCss, /\.rich-text-toolbar-dropdown-color \.rich-text-toolbar-menu \{[^}]*right: auto; left: calc\(50% \+ 9px\); transform: translateX\(-50%\); \}/u)
  assert.match(mobileCss, /\.rich-text-toolbar-dropdown-list \.rich-text-toolbar-menu \{[^}]*right: 0; left: auto; \}/u)
})

test('toolbar dropdowns keep the existing user-driven selection behavior', () => {
  assert.match(editor, /onPointerDown=\{handleHeadingTriggerPointerDown\}/u)
  assert.match(editor, /onClick=\{\(\) => toggleToolbarMenu\('size'\)\}/u)
  assert.match(editor, /onClick=\{\(\) => toggleToolbarMenu\('color'\)\}/u)
  assert.match(editor, /onClick=\{\(\) => toggleToolbarMenu\('list'\)\}/u)
  assert.match(editor, /rememberToolbarPointerDown/u)
  assert.match(editor, /setOpenMenu\(\(current\) => current === menu \? null : menu\)/u)
  assert.match(editor, /onFocus=\{closeToolbarMenus\}/u)
  assert.match(editor, /onCompositionStart=\{closeToolbarMenus\}/u)
  assert.match(editor, /document\.addEventListener\('pointerdown'/u)
  assert.match(editor, /event\.key !== 'Escape'/u)
})
