'use client'

import { Mark, mergeAttributes, Node as TiptapNode, type Editor } from '@tiptap/core'
import Bold from '@tiptap/extension-bold'
import Document from '@tiptap/extension-document'
import HardBreak from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import Paragraph from '@tiptap/extension-paragraph'
import Placeholder from '@tiptap/extension-placeholder'
import Text from '@tiptap/extension-text'
import { EditorContent, useEditor } from '@tiptap/react'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  RICH_TEXT_COLOR_TOKENS,
  RICH_TEXT_FONT_SIZE_TOKENS,
  isRichTextColorToken,
  isRichTextFontSizeToken,
  legacyHtmlToRichContent,
  normalizeRichTextHref,
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
  /** Kept for old callers; rich content is now always enabled. */
  compatibilityMode?: boolean
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

const blockLabels = {
  paragraph: '正文',
  1: '一级标题',
  2: '二级标题',
  3: '三级标题',
} as const

const toolbarButtonClass = (active = false) => [
  'rich-text-toolbar-button',
  active ? 'is-active' : '',
].filter(Boolean).join(' ')

const menuItemClass = (active = false) => [
  'rich-text-toolbar-menu-item',
  active ? 'is-active' : '',
].filter(Boolean).join(' ')

function RichSimpleMark({
  name,
  tag,
}: Readonly<{ name: string; tag: string }>) {
  return Mark.create({
    name,
    inclusive: true,
    parseHTML() {
      return [{ tag }]
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, HTMLAttributes, 0]
    },
  })
}

function RichLinkMark() {
  return Mark.create({
    name: 'link',
    inclusive: false,
    addAttributes() {
      return {
        href: {
          default: null,
          parseHTML: (element: HTMLElement) => normalizeRichTextHref(element.getAttribute('href')),
          renderHTML: (attributes: { href?: unknown }) => {
            const href = normalizeRichTextHref(attributes.href)
            return href ? { href } : {}
          },
        },
      }
    },
    parseHTML() {
      return [{ tag: 'a[href]' }]
    },
    renderHTML({ HTMLAttributes }) {
      return ['a', mergeAttributes(HTMLAttributes, {
        target: '_blank',
        rel: 'noopener noreferrer',
      }), 0]
    },
  })
}

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

const richHeading = TiptapNode.create({
  name: 'heading',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: (element: HTMLElement) => Number(element.tagName.slice(1)) || 1,
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'h1' }, { tag: 'h2' }, { tag: 'h3' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const level = Math.min(3, Math.max(1, Number(node.attrs.level) || 1))
    return ['h' + level, HTMLAttributes, 0]
  },
})

const richListItem = TiptapNode.create({
  name: 'listItem',
  group: 'block',
  content: 'paragraph block*',
  defining: true,
  parseHTML() {
    return [{ tag: 'li' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['li', HTMLAttributes, 0]
  },
})

const richBulletList = TiptapNode.create({
  name: 'bulletList',
  group: 'block list',
  content: 'listItem+',
  parseHTML() {
    return [{ tag: 'ul' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['ul', HTMLAttributes, 0]
  },
})

const richOrderedList = TiptapNode.create({
  name: 'orderedList',
  group: 'block list',
  content: 'listItem+',
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (element: HTMLElement) => Number(element.getAttribute('start')) || 1,
        renderHTML: (attributes: { start?: unknown }) => {
          const start = Number(attributes.start)
          return Number.isSafeInteger(start) && start > 1 ? { start } : {}
        },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'ol' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['ol', HTMLAttributes, 0]
  },
})

const richBlockquote = TiptapNode.create({
  name: 'blockquote',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'blockquote' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['blockquote', HTMLAttributes, 0]
  },
})

const richHorizontalRule = TiptapNode.create({
  name: 'horizontalRule',
  group: 'block',
  atom: true,
  parseHTML() {
    return [{ tag: 'hr' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['hr', HTMLAttributes]
  },
})

const richCodeBlock = TiptapNode.create({
  name: 'codeBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  parseHTML() {
    return [{ tag: 'pre', preserveWhitespace: 'full' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['pre', HTMLAttributes, ['code', {}, 0]]
  },
})

const richTextExtensions = [
  Document,
  Paragraph,
  Text,
  HardBreak,
  Bold,
  RichSimpleMark({ name: 'italic', tag: 'em' }),
  RichSimpleMark({ name: 'strike', tag: 's' }),
  RichSimpleMark({ name: 'code', tag: 'code' }),
  RichLinkMark(),
  richHeading,
  richBulletList,
  richOrderedList,
  richListItem,
  richBlockquote,
  richHorizontalRule,
  richCodeBlock,
  History.configure({ depth: 100 }),
  Placeholder.configure({ placeholder: '分享你的想法...' }),
  RichColorMark(),
  RichFontSizeMark(),
]

function sanitizePastedHtml(html: string) {
  if (typeof window === 'undefined') return html
  const parsed = new window.DOMParser().parseFromString(html, 'text/html')
  const dangerousTags = new Set(['script', 'style', 'link', 'iframe', 'object', 'embed', 'meta', 'form', 'input', 'textarea', 'button', 'video', 'audio', 'img', 'svg', 'math'])
  const allowedTags = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 's', 'del', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'hr', 'a', 'code', 'pre', 'span'])
  const blockTags = new Set(['address', 'article', 'aside', 'div', 'dl', 'dt', 'dd', 'figcaption', 'figure', 'footer', 'header', 'main', 'nav', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr'])

  const escapeText = (value: string) => value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
  const escapeAttribute = (value: string) => escapeText(value).replace(/"/gu, '&quot;')
  const renderNode = (node: globalThis.Node): string => {
    if (node.nodeType === 3) return escapeText(node.textContent || '')
    if (node.nodeType !== 1) return ''
    const element = node as HTMLElement
    const tag = element.tagName.toLowerCase()
    if (dangerousTags.has(tag)) return ''
    if (tag === 'br' || tag === 'hr') return '<' + tag + '>'
    const children = Array.from(element.childNodes).map(renderNode).join('')
    if (!allowedTags.has(tag)) return blockTags.has(tag) ? '<p>' + children + '</p>' : children
    if (tag === 'a') {
      const href = normalizeRichTextHref(element.getAttribute('href'))
      return href ? '<a href="' + escapeAttribute(href) + '">' + children + '</a>' : children
    }
    if (tag === 'span') {
      const attributes = [
        isRichTextColorToken(element.getAttribute('data-rich-color')) ? 'data-rich-color="' + element.getAttribute('data-rich-color') + '"' : '',
        isRichTextFontSizeToken(element.getAttribute('data-rich-size')) ? 'data-rich-size="' + element.getAttribute('data-rich-size') + '"' : '',
      ].filter(Boolean)
      return attributes.length ? '<span ' + attributes.join(' ') + '>' + children + '</span>' : children
    }
    return '<' + tag + '>' + children + '</' + tag + '>'
  }

  return Array.from(parsed.body.childNodes).map(renderNode).join('')
}

function initialEditorContent(initialRichContent: unknown | null | undefined, initialContent: string) {
  if (initialRichContent !== null && initialRichContent !== undefined) {
    const result = validateRichPostContent(initialRichContent)
    if (result.valid) return result.value
  }
  return legacyHtmlToRichContent(initialContent) || plainTextToRichContent(initialContent)
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
  const [openMenu, setOpenMenu] = useState<'block' | 'size' | 'color' | null>(null)
  const [toolbarNotice, setToolbarNotice] = useState('')
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
      if (!toolbarRef.current?.contains(event.target as globalThis.Node)) setOpenMenu(null)
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
  const activeHeading = [1, 2, 3].find((level) => activeEditor.isActive('heading', { level })) as 1 | 2 | 3 | undefined
  const blockLabel = activeHeading ? blockLabels[activeHeading] : '正文'
  const stopToolbarBlur = (event: MouseEvent<HTMLButtonElement>) => event.preventDefault()

  function applySize(token: RichTextFontSizeToken) {
    activeEditor.chain().focus().setMark('fontSize', { token }).run()
    setOpenMenu(null)
  }

  function applyColor(token: RichTextColorToken) {
    if (token === 'default') activeEditor.chain().focus().unsetMark('textColor').run()
    else activeEditor.chain().focus().setMark('textColor', { token }).run()
    setOpenMenu(null)
  }

  function applyBlock(level: 'paragraph' | 1 | 2 | 3) {
    if (level === 'paragraph') activeEditor.chain().focus().setNode('paragraph').run()
    else activeEditor.chain().focus().setNode('heading', { level }).run()
    setOpenMenu(null)
  }

  function applyLink() {
    const currentHref = activeEditor.getAttributes('link').href
    const input = window.prompt('链接地址', typeof currentHref === 'string' ? currentHref : '')
    if (input === null) return
    if (!input.trim()) {
      activeEditor.chain().focus().unsetMark('link').run()
      setToolbarNotice('')
      return
    }
    const href = normalizeRichTextHref(input)
    if (!href) {
      setToolbarNotice('链接地址无效或不安全')
      return
    }
    activeEditor.chain().focus().setMark('link', { href }).run()
    setToolbarNotice('')
  }

  function clearFormatting() {
    activeEditor.chain().focus().unsetAllMarks().setNode('paragraph').run()
    setOpenMenu(null)
  }

  return (
    <div className="rich-text-editor-shell">
      <div ref={toolbarRef} className="rich-text-toolbar" aria-label="正文排版工具栏">
        <div className="relative">
          <button
            type="button"
            className={toolbarButtonClass(Boolean(activeHeading))}
            aria-haspopup="menu"
            aria-expanded={openMenu === 'block'}
            onMouseDown={stopToolbarBlur}
            onClick={() => setOpenMenu(openMenu === 'block' ? null : 'block')}
          >
            {blockLabel}<span aria-hidden="true">⌄</span>
          </button>
          {openMenu === 'block' ? (
            <div className="rich-text-toolbar-menu" role="menu" aria-label="段落样式">
              {([
                ['paragraph', '正文'],
                [1, '一级标题'],
                [2, '二级标题'],
                [3, '三级标题'],
              ] as const).map(([value, label]) => (
                <button
                  type="button"
                  role="menuitem"
                  key={String(value)}
                  className={menuItemClass((value === 'paragraph' && !activeHeading) || value === activeHeading)}
                  onMouseDown={stopToolbarBlur}
                  onClick={() => applyBlock(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className={toolbarButtonClass(activeEditor.isActive('bold'))}
          aria-label="加粗"
          aria-pressed={activeEditor.isActive('bold')}
          onMouseDown={stopToolbarBlur}
          onClick={() => activeEditor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className={toolbarButtonClass(activeEditor.isActive('italic'))}
          aria-label="斜体"
          aria-pressed={activeEditor.isActive('italic')}
          onMouseDown={stopToolbarBlur}
          onClick={() => activeEditor.chain().focus().toggleMark('italic').run()}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className={toolbarButtonClass(activeEditor.isActive('strike'))}
          aria-label="删除线"
          aria-pressed={activeEditor.isActive('strike')}
          onMouseDown={stopToolbarBlur}
          onClick={() => activeEditor.chain().focus().toggleMark('strike').run()}
        >
          <s>S</s>
        </button>

        <button
          type="button"
          className={toolbarButtonClass(activeEditor.isActive('bulletList'))}
          aria-label="无序列表"
          aria-pressed={activeEditor.isActive('bulletList')}
          onMouseDown={stopToolbarBlur}
          onClick={() => activeEditor.chain().focus().toggleList('bulletList', 'listItem').run()}
        >
          • 列表
        </button>
        <button
          type="button"
          className={toolbarButtonClass(activeEditor.isActive('orderedList'))}
          aria-label="有序列表"
          aria-pressed={activeEditor.isActive('orderedList')}
          onMouseDown={stopToolbarBlur}
          onClick={() => activeEditor.chain().focus().toggleList('orderedList', 'listItem').run()}
        >
          1. 列表
        </button>
        <button
          type="button"
          className={toolbarButtonClass(activeEditor.isActive('blockquote'))}
          aria-label="引用"
          aria-pressed={activeEditor.isActive('blockquote')}
          onMouseDown={stopToolbarBlur}
          onClick={() => activeEditor.chain().focus().toggleWrap('blockquote').run()}
        >
          “ 引用
        </button>
        <button
          type="button"
          className={toolbarButtonClass(activeEditor.isActive('link'))}
          aria-label="添加或编辑链接"
          aria-pressed={activeEditor.isActive('link')}
          onMouseDown={stopToolbarBlur}
          onClick={applyLink}
        >
          链接
        </button>
        <button
          type="button"
          className={toolbarButtonClass()}
          aria-label="插入分割线"
          onMouseDown={stopToolbarBlur}
          onClick={() => activeEditor.chain().focus().insertContent({ type: 'horizontalRule' }).run()}
        >
          分割线
        </button>

        <div className="relative">
          <button
            type="button"
            className={toolbarButtonClass(Boolean(currentSize))}
            aria-haspopup="menu"
            aria-expanded={openMenu === 'size'}
            onMouseDown={stopToolbarBlur}
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
                  onMouseDown={stopToolbarBlur}
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
            onMouseDown={stopToolbarBlur}
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
                  onMouseDown={stopToolbarBlur}
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
          onMouseDown={stopToolbarBlur}
          onClick={clearFormatting}
        >
          清除格式
        </button>
        <button
          type="button"
          className={toolbarButtonClass()}
          aria-label="撤销"
          disabled={!activeEditor.can().undo()}
          onMouseDown={stopToolbarBlur}
          onClick={() => activeEditor.chain().focus().undo().run()}
        >
          ↶ <span className="sr-only">撤销</span>
        </button>
        <button
          type="button"
          className={toolbarButtonClass()}
          aria-label="重做"
          disabled={!activeEditor.can().redo()}
          onMouseDown={stopToolbarBlur}
          onClick={() => activeEditor.chain().focus().redo().run()}
        >
          ↷ <span className="sr-only">重做</span>
        </button>
      </div>
      {toolbarNotice ? <p className="rich-text-toolbar-notice" role="status">{toolbarNotice}</p> : null}
      <EditorContent editor={editor} className="rich-text-editor-content" data-placeholder={placeholder} />
    </div>
  )
})
