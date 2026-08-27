'use client'

import { Mark, type Editor } from '@tiptap/core'
import Bold from '@tiptap/extension-bold'
import Document from '@tiptap/extension-document'
import HardBreak from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import Paragraph from '@tiptap/extension-paragraph'
import Placeholder from '@tiptap/extension-placeholder'
import Text from '@tiptap/extension-text'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react'
import {
  RICH_TEXT_COLOR_TOKENS,
  RICH_TEXT_FONT_SIZE_TOKENS,
  isRichTextColorToken,
  isRichTextFontSizeToken,
  plainTextToRichContent,
  richTextColorClass,
  richTextFontSizeClass,
  validateRichPostContent,
  type RichTextColorToken,
  type RichTextContent,
  type RichTextFontSizeToken,
} from '@/lib/rich-text'

export type RichTextEditorHandle = {
  focus: () => void
  insertText: (text: string) => void
}

type RichTextEditorProps = {
  initialContent?: string
  initialRichContent?: unknown | null
  onChange: (content: RichTextContent, plainText: string) => void
  placeholder?: string
}

const colorLabels: Record<RichTextColorToken, string> = {
  default: '默认',
  gray: '灰色',
  red: '红色',
  orange: '橙色',
  yellow: '黄色',
  green: '绿色',
  cyan: '青色',
  blue: '蓝色',
  purple: '紫色',
  pink: '粉色',
}

const fontSizeLabels: Record<RichTextFontSizeToken, string> = {
  small: '小',
  normal: '正文',
  large: '大',
  title: '标题',
}

const toolbarButtonClass = (active = false) => [
  'inline-flex min-h-9 items-center justify-center gap-1 border px-3 text-xs font-black transition',
  active
    ? 'border-brand-600 bg-sky-100 text-brand-800'
    : 'border-sky-100 bg-white text-slate-600 hover:border-sky-300 hover:bg-sky-50',
].join(' ')

const menuItemClass = (active = false) => [
  'flex min-h-10 w-full items-center gap-2 px-3 text-left text-xs font-black transition',
  active ? 'bg-sky-100 text-brand-800' : 'text-slate-600 hover:bg-sky-50',
].join(' ')

function RichColorMark() {
  return Mark.create({
    name: 'textColor',
    inclusive: true,
    addAttributes() {
      return {
        token: {
          default: 'default',
          parseHTML: (element: HTMLElement) => {
            const token = element.getAttribute('data-rich-color')
            return isRichTextColorToken(token) ? token : null
          },
          renderHTML: (attributes: { token?: unknown }) => {
            const token = attributes.token
            if (!isRichTextColorToken(token)) return {}
            return { 'data-rich-color': token, class: richTextColorClass(token) }
          },
        },
      }
    },
    parseHTML() {
      return [{ tag: 'span[data-rich-color]' }]
    },
    renderHTML({ HTMLAttributes }) {
      return ['span', HTMLAttributes, 0]
    },
  })
}

function RichFontSizeMark() {
  return Mark.create({
    name: 'fontSize',
    inclusive: true,
    addAttributes() {
      return {
        token: {
          default: 'normal',
          parseHTML: (element: HTMLElement) => {
            const token = element.getAttribute('data-rich-size')
            return isRichTextFontSizeToken(token) ? token : null
          },
          renderHTML: (attributes: { token?: unknown }) => {
            const token = attributes.token
            if (!isRichTextFontSizeToken(token)) return {}
            return { 'data-rich-size': token, class: richTextFontSizeClass(token) }
          },
        },
      }
    },
    parseHTML() {
      return [{ tag: 'span[data-rich-size]' }]
    },
    renderHTML({ HTMLAttributes }) {
      return ['span', HTMLAttributes, 0]
    },
  })
}

const richColorMark = RichColorMark()
const richFontSizeMark = RichFontSizeMark()
const richTextExtensions = [
  Document,
  Paragraph,
  Text,
  HardBreak,
  Bold,
  History.configure({ depth: 100 }),
  Placeholder.configure({ placeholder: '分享你的想法...' }),
  richColorMark,
  richFontSizeMark,
]

function sanitizePastedHtml(html: string) {
  if (typeof window === 'undefined') return html
  const parsed = new window.DOMParser().parseFromString(html, 'text/html')
  const dangerousTags = new Set(['script', 'style', 'link', 'iframe', 'object', 'embed', 'meta', 'form', 'input', 'textarea', 'button', 'video', 'audio', 'img', 'svg', 'math'])
  const paragraphTags = new Set(['address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'header', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'])

  function escapeText(value: string) {
    return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
  }

  function renderInline(node: Node): string {
    if (node.nodeType === 3) return escapeText(node.textContent || '')
    if (node.nodeType !== 1) return ''
    const element = node as HTMLElement
    const tag = element.tagName.toLowerCase()
    if (dangerousTags.has(tag)) return ''
    if (tag === 'br') return '<br>'
    const children = Array.from(element.childNodes).map(renderInline).join('')
    if (tag === 'strong' || tag === 'b') return `<strong>${children}</strong>`
    if (tag === 'span') {
      const color = element.getAttribute('data-rich-color')
      const size = element.getAttribute('data-rich-size')
      const attributes = [
        isRichTextColorToken(color) ? `data-rich-color="${color}"` : '',
        isRichTextFontSizeToken(size) ? `data-rich-size="${size}"` : '',
      ].filter(Boolean)
      return attributes.length ? `<span ${attributes.join(' ')}>${children}</span>` : children
    }
    return children
  }

  function renderBlock(element: Element): string {
    const tag = element.tagName.toLowerCase()
    if (tag === 'p') return `<p>${Array.from(element.childNodes).map(renderInline).join('')}</p>`
    return renderNodes(Array.from(element.childNodes)) || '<p></p>'
  }

  function renderNodes(nodes: Node[]): string {
    let output = ''
    let inline = ''
    const flushInline = () => {
      if (!inline) return
      output += `<p>${inline}</p>`
      inline = ''
    }
    for (const node of nodes) {
      if (node.nodeType === 1 && paragraphTags.has((node as Element).tagName.toLowerCase())) {
        flushInline()
        output += renderBlock(node as Element)
      } else {
        inline += renderInline(node)
      }
    }
    flushInline()
    return output
  }

  return renderNodes(Array.from(parsed.body.childNodes))
}

function initialEditorContent(initialRichContent: unknown | null | undefined, initialContent: string) {
  if (initialRichContent !== null && initialRichContent !== undefined) {
    const result = validateRichPostContent(initialRichContent)
    if (result.valid) return result.value
  }
  return plainTextToRichContent(initialContent)
}

function emitEditorChange(editor: Editor, onChange: RichTextEditorProps['onChange']) {
  const result = validateRichPostContent(editor.getJSON())
  if (!result.valid) {
    console.error('[rich-text:editor:invalid-state]', { errors: result.errors })
    return
  }
  onChange(result.value, result.plainText)
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor({
  initialContent = '',
  initialRichContent,
  onChange,
  placeholder = '分享你的想法...',
}, ref) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const initialDocument = useMemo(
    () => initialEditorContent(initialRichContent, initialContent),
    [initialContent, initialRichContent],
  )
  const [openMenu, setOpenMenu] = useState<'size' | 'color' | null>(null)
  const [, setToolbarVersion] = useState(0)
  const editor = useEditor({
    extensions: richTextExtensions,
    content: initialDocument,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'rich-text-editor-surface',
        'aria-label': '帖子正文',
        spellcheck: 'true',
      },
      transformPastedHTML: sanitizePastedHtml,
    },
    onCreate: ({ editor: createdEditor }) => emitEditorChange(createdEditor, onChange),
    onUpdate: ({ editor: updatedEditor }) => emitEditorChange(updatedEditor, onChange),
    onTransaction: () => setToolbarVersion((version) => version + 1),
  })

  useEffect(() => {
    if (!openMenu) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [openMenu])

  useImperativeHandle(ref, () => ({
    focus: () => editor?.chain().focus().run(),
    insertText: (text: string) => {
      if (!editor || !text) return
      editor.chain().focus().insertContent(text).run()
    },
  }), [editor])

  if (!editor) {
    return <div className="rich-text-editor-loading" aria-live="polite">正在加载编辑器…</div>
  }

  const activeEditor = editor
  const activeSize = activeEditor.getAttributes('fontSize').token
  const activeColor = activeEditor.getAttributes('textColor').token
  const currentSize = isRichTextFontSizeToken(activeSize) ? activeSize : null
  const currentColor = isRichTextColorToken(activeColor) && activeColor !== 'default' ? activeColor : null
  const stopToolbarBlur = (event: React.PointerEvent<HTMLButtonElement>) => event.preventDefault()

  function applySize(token: RichTextFontSizeToken) {
    activeEditor.chain().focus().setMark('fontSize', { token }).run()
    setOpenMenu(null)
  }

  function applyColor(token: RichTextColorToken) {
    if (token === 'default') activeEditor.chain().focus().unsetMark('textColor').run()
    else activeEditor.chain().focus().setMark('textColor', { token }).run()
    setOpenMenu(null)
  }

  function clearFormatting() {
    activeEditor.chain().focus().unsetMark('bold').unsetMark('fontSize').unsetMark('textColor').run()
    setOpenMenu(null)
  }

  return (
    <div className="rich-text-editor-shell">
      <div ref={toolbarRef} className="rich-text-toolbar" aria-label="正文排版工具栏">
        <button
          type="button"
          className={toolbarButtonClass(activeEditor.isActive('bold'))}
          aria-label="加粗"
          aria-pressed={activeEditor.isActive('bold')}
          onPointerDown={stopToolbarBlur}
          onClick={() => activeEditor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </button>

        <div className="relative">
          <button
            type="button"
            className={toolbarButtonClass(Boolean(currentSize))}
            aria-haspopup="menu"
            aria-expanded={openMenu === 'size'}
            onPointerDown={stopToolbarBlur}
            onClick={() => setOpenMenu(openMenu === 'size' ? null : 'size')}
          >
            字号<span aria-hidden="true">⌄</span>
          </button>
          {openMenu === 'size' ? (
            <div className="rich-text-toolbar-menu" role="menu" aria-label="字号">
              {RICH_TEXT_FONT_SIZE_TOKENS.map((token) => (
                <button
                  type="button"
                  role="menuitem"
                  key={token}
                  className={menuItemClass(currentSize === token)}
                  onPointerDown={stopToolbarBlur}
                  onClick={() => applySize(token)}
                >
                  {fontSizeLabels[token]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="relative">
          <button
            type="button"
            className={toolbarButtonClass(Boolean(currentColor))}
            aria-haspopup="menu"
            aria-expanded={openMenu === 'color'}
            onPointerDown={stopToolbarBlur}
            onClick={() => setOpenMenu(openMenu === 'color' ? null : 'color')}
          >
            <span className="rich-text-color-trigger">A</span>
            <span>{currentColor ? colorLabels[currentColor] : '颜色'}</span>
            <span aria-hidden="true">⌄</span>
          </button>
          {openMenu === 'color' ? (
            <div className="rich-text-toolbar-menu rich-text-color-menu" role="menu" aria-label="文字颜色">
              {RICH_TEXT_COLOR_TOKENS.map((token) => (
                <button
                  type="button"
                  role="menuitem"
                  key={token}
                  className={menuItemClass((token === 'default' && !currentColor) || currentColor === token)}
                  onPointerDown={stopToolbarBlur}
                  onClick={() => applyColor(token)}
                >
                  <span className={'rich-text-color-dot ' + richTextColorClass(token)} aria-hidden="true" />
                  {colorLabels[token]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className={toolbarButtonClass()}
          onPointerDown={stopToolbarBlur}
          onClick={clearFormatting}
        >
          清除格式
        </button>
        <button
          type="button"
          className={toolbarButtonClass()}
          aria-label="撤销"
          disabled={!activeEditor.can().undo()}
          onPointerDown={stopToolbarBlur}
          onClick={() => activeEditor.chain().focus().undo().run()}
        >
          ↶ <span className="sr-only">撤销</span>
        </button>
        <button
          type="button"
          className={toolbarButtonClass()}
          aria-label="重做"
          disabled={!activeEditor.can().redo()}
          onPointerDown={stopToolbarBlur}
          onClick={() => activeEditor.chain().focus().redo().run()}
        >
          ↷ <span className="sr-only">重做</span>
        </button>
      </div>
      <EditorContent editor={editor} className="rich-text-editor-content" data-placeholder={placeholder} />
    </div>
  )
})
