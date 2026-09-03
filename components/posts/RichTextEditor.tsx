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
import { createPortal } from 'react-dom'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { MusicReferencePicker, type MusicReferenceSong } from '@/components/posts/MusicReferencePicker'
import { PostReferencePicker, type PostReferencePost } from '@/components/posts/PostReferencePicker'
import { UserMentionPicker, type UserMentionUser } from '@/components/posts/UserMentionPicker'
import { ActivityReferencePicker, type ActivityReferenceActivity } from '@/components/posts/ActivityReferencePicker'
import { MaterialReferencePicker, type MaterialReferenceMaterial } from '@/components/posts/MaterialReferencePicker'
import {
  RICH_TEXT_COLOR_TOKENS,
  RICH_TEXT_FONT_SIZE_TOKENS,
  countMusicReferenceNodes,
  isRichTextColorToken,
  isRichTextFontSizeToken,
  legacyHtmlToRichContent,
  normalizeRichTextHref,
  plainTextToRichContent,
  richTextColorClass,
  richTextFontSizeClass,
  MAX_RICH_TEXT_MUSIC_REFERENCES,
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

type HeadingLevel = 1 | 2 | 3

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    italic: {
      toggleItalic: () => ReturnType
    }
    strike: {
      toggleStrike: () => ReturnType
    }
    bulletList: {
      toggleBulletList: () => ReturnType
    }
    orderedList: {
      toggleOrderedList: () => ReturnType
    }
  }
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

function getActiveHeadingLevel(editor: Editor): HeadingLevel | undefined {
  const headingLevels: HeadingLevel[] = [1, 2, 3]
  return headingLevels.find((level) => editor.isActive('heading', { level }))
}

const toolbarButtonClass = (active = false) => [
  'rich-text-toolbar-button',
  active ? 'is-active' : '',
].filter(Boolean).join(' ')

const menuItemClass = (active = false) => [
  'rich-text-toolbar-menu-item',
  active ? 'is-active' : '',
].filter(Boolean).join(' ')

type InlineMarkToolbarState = Readonly<{
  bold: boolean
  italic: boolean
  strike: boolean
  bulletList: boolean
  orderedList: boolean
  fontSize: RichTextFontSizeToken | null
  textColor: RichTextColorToken | null
}>

const emptyInlineMarkToolbarState: InlineMarkToolbarState = {
  bold: false,
  italic: false,
  strike: false,
  bulletList: false,
  orderedList: false,
  fontSize: null,
  textColor: null,
}

const inlineMarkEditorEvents = ['selectionUpdate', 'transaction', 'update', 'focus', 'blur'] as const

function useInlineMarkToolbarState(editor: Editor | null): InlineMarkToolbarState {
  const snapshotRef = useRef<{
    editor: Editor | null
    key: string
    value: InlineMarkToolbarState
  }>({
    editor: null,
    key: 'empty',
    value: emptyInlineMarkToolbarState,
  })

  const getSnapshot = useCallback((): InlineMarkToolbarState => {
    if (!editor) return emptyInlineMarkToolbarState

    const nextValue: InlineMarkToolbarState = {
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      fontSize: isRichTextFontSizeToken(editor.getAttributes('fontSize').token) ? editor.getAttributes('fontSize').token : null,
      textColor: isRichTextColorToken(editor.getAttributes('textColor').token) && editor.getAttributes('textColor').token !== 'default'
        ? editor.getAttributes('textColor').token
        : null,
    }
    const nextKey = [
      nextValue.bold,
      nextValue.italic,
      nextValue.strike,
      nextValue.bulletList,
      nextValue.orderedList,
      nextValue.fontSize || '',
      nextValue.textColor || '',
    ].map((value) => typeof value === 'boolean' ? Number(value) : value).join('|')
    const previous = snapshotRef.current
    if (previous.editor === editor && previous.key === nextKey) return previous.value

    snapshotRef.current = { editor, key: nextKey, value: nextValue }
    return nextValue
  }, [editor])

  const subscribe = useCallback((onStoreChange: () => void) => {
    if (!editor) return () => {}

    const listener = () => onStoreChange()
    inlineMarkEditorEvents.forEach((eventName) => editor.on(eventName, listener))
    return () => {
      inlineMarkEditorEvents.forEach((eventName) => editor.off(eventName, listener))
    }
  }, [editor])

  return useSyncExternalStore(subscribe, getSnapshot, () => emptyInlineMarkToolbarState)
}

function RichSimpleMark({
  name,
  tag,
  commandName,
}: Readonly<{ name: string; tag: string; commandName?: 'italic' | 'strike' }>) {
  return Mark.create({
    name,
    inclusive: true,
    parseHTML() {
      return [{ tag }]
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, HTMLAttributes, 0]
    },
    addCommands() {
      if (commandName === 'italic') {
        return {
          toggleItalic: () => ({ commands }: { commands: { toggleMark: (mark: string) => boolean } }) => commands.toggleMark('italic'),
        }
      }
      if (commandName === 'strike') {
        return {
          toggleStrike: () => ({ commands }: { commands: { toggleMark: (mark: string) => boolean } }) => commands.toggleMark('strike'),
        }
      }
      return {}
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

function isEmptyListItemAtStart(editor: Editor) {
  const { selection } = editor.state
  const { $from } = selection
  return selection.empty
    && $from.parent.isTextblock
    && $from.parentOffset === 0
    && $from.parent.content.size === 0
    && $from.node(-1).type.name === 'listItem'
}

type RichListCommandContext = {
  commands: {
    toggleList: (listTypeOrName: string, itemTypeOrName: string) => boolean
  }
}

const richListItem = TiptapNode.create({
  name: 'listItem',
  priority: 1100,
  content: 'paragraph block*',
  defining: true,
  parseHTML() {
    return [{ tag: 'li' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['li', HTMLAttributes, 0]
  },
  addKeyboardShortcuts() {
    const handleEnter = () => this.editor.commands.first(({ commands }) => [
      () => commands.newlineInCode(),
      () => commands.splitListItem('listItem'),
      () => commands.createParagraphNear(),
      () => commands.liftEmptyBlock(),
      () => commands.splitBlock(),
    ])
    const handleBackspace = () => {
      // Only intercept the one list-specific case.  Returning false for every
      // other caret/selection lets ProseMirror's native keymap handle normal
      // character deletion, range deletion, and IME-generated Backspace.
      if (!isEmptyListItemAtStart(this.editor)) return false
      return this.editor.commands.liftListItem('listItem')
    }

    return {
      Enter: handleEnter,
      Backspace: handleBackspace,
    }
  },
})

const richBulletList = TiptapNode.create({
  name: 'bulletList',
  group: 'block list',
  content: 'listItem+',
  addCommands() {
    return {
      toggleBulletList: () => ({ commands }: RichListCommandContext) => commands.toggleList('bulletList', 'listItem'),
    }
  },
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
  addCommands() {
    return {
      toggleOrderedList: () => ({ commands }: RichListCommandContext) => commands.toggleList('orderedList', 'listItem'),
    }
  },
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

const richMusicReference = TiptapNode.create({
  name: 'musicReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      songId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-music-song-id'),
        renderHTML: (attributes: { songId?: unknown }) => typeof attributes.songId === 'string' && attributes.songId ? { 'data-music-song-id': attributes.songId } : {},
      },
      title: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-music-title') || '',
        renderHTML: (attributes: { title?: unknown }) => typeof attributes.title === 'string' && attributes.title ? { 'data-music-title': attributes.title } : {},
      },
      artist: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-music-artist') || '',
        renderHTML: (attributes: { artist?: unknown }) => typeof attributes.artist === 'string' && attributes.artist ? { 'data-music-artist': attributes.artist } : {},
      },
      album: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-music-album') || '',
        renderHTML: (attributes: { album?: unknown }) => typeof attributes.album === 'string' && attributes.album ? { 'data-music-album': attributes.album } : {},
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-music-reference]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const title = typeof node.attrs.title === 'string' && node.attrs.title ? node.attrs.title : '歌曲引用'
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-music-reference': 'true',
      class: 'rich-text-music-reference',
      contenteditable: 'false',
      'aria-label': `歌曲引用：${title}`,
    }), `♪ ${title}`]
  },
})

function parseOptionalUid(value: string | null) {
  return value && /^\d{1,5}$/u.test(value) ? Number(value) : null
}

const richPostReference = TiptapNode.create({
  name: 'postReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      postId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-post-id'),
        renderHTML: (attributes: { postId?: unknown }) => typeof attributes.postId === 'string' && attributes.postId ? { 'data-post-id': attributes.postId } : {},
      },
      title: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-post-title') || '',
        renderHTML: (attributes: { title?: unknown }) => typeof attributes.title === 'string' && attributes.title ? { 'data-post-title': attributes.title } : {},
      },
      authorName: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-post-author-name') || '',
        renderHTML: (attributes: { authorName?: unknown }) => typeof attributes.authorName === 'string' && attributes.authorName ? { 'data-post-author-name': attributes.authorName } : {},
      },
      authorUid: {
        default: null,
        parseHTML: (element: HTMLElement) => parseOptionalUid(element.getAttribute('data-post-author-uid')),
        renderHTML: (attributes: { authorUid?: unknown }) => Number.isSafeInteger(attributes.authorUid) ? { 'data-post-author-uid': String(attributes.authorUid) } : {},
      },
      available: {
        default: true,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-post-reference-available') !== 'false',
        renderHTML: (attributes: { available?: unknown }) => ({ 'data-post-reference-available': attributes.available === false ? 'false' : 'true' }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-post-reference]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const unavailable = node.attrs.available === false
    const title = unavailable ? '该引用帖子已不可用' : typeof node.attrs.title === 'string' && node.attrs.title ? node.attrs.title : '引用帖子'
    const author = unavailable ? '' : typeof node.attrs.authorName === 'string' && node.attrs.authorName ? node.attrs.authorName : '未知作者'
    const uid = unavailable || !Number.isSafeInteger(node.attrs.authorUid) ? '' : `UID ${String(node.attrs.authorUid).padStart(5, '0')}`
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-post-reference': 'true',
      class: 'rich-text-post-reference',
      contenteditable: 'false',
      'aria-label': `引用帖子：${title}`,
    }),
    ['span', { class: 'rich-text-post-reference-icon', 'aria-hidden': 'true' }, '↗'],
    ['span', { class: 'rich-text-post-reference-copy' },
      ['strong', {}, '引用帖子'],
      ['span', {}, `《${title}》`],
      ['small', {}, [author, uid].filter(Boolean).join(' · ')],
    ]]
  },
})

const richActivityReference = TiptapNode.create({
  name: 'activityReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      activityId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-activity-id'),
        renderHTML: (attributes: { activityId?: unknown }) => typeof attributes.activityId === 'string' && attributes.activityId ? { 'data-activity-id': attributes.activityId } : {},
      },
      titleSnapshot: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-activity-title-snapshot') || '',
        renderHTML: (attributes: { titleSnapshot?: unknown }) => typeof attributes.titleSnapshot === 'string' && attributes.titleSnapshot ? { 'data-activity-title-snapshot': attributes.titleSnapshot } : {},
      },
      title: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-activity-title') || '',
        renderHTML: (attributes: { title?: unknown }) => typeof attributes.title === 'string' && attributes.title ? { 'data-activity-title': attributes.title } : {},
      },
      coverUrl: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-activity-cover-url') || '',
        renderHTML: (attributes: { coverUrl?: unknown }) => typeof attributes.coverUrl === 'string' && attributes.coverUrl ? { 'data-activity-cover-url': attributes.coverUrl } : {},
      },
      bannerUrl: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-activity-banner-url') || '',
        renderHTML: (attributes: { bannerUrl?: unknown }) => typeof attributes.bannerUrl === 'string' && attributes.bannerUrl ? { 'data-activity-banner-url': attributes.bannerUrl } : {},
      },
      startsAt: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-activity-starts-at') || '',
        renderHTML: (attributes: { startsAt?: unknown }) => typeof attributes.startsAt === 'string' && attributes.startsAt ? { 'data-activity-starts-at': attributes.startsAt } : {},
      },
      endsAt: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-activity-ends-at') || '',
        renderHTML: (attributes: { endsAt?: unknown }) => typeof attributes.endsAt === 'string' && attributes.endsAt ? { 'data-activity-ends-at': attributes.endsAt } : {},
      },
      locationName: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-activity-location') || '',
        renderHTML: (attributes: { locationName?: unknown }) => typeof attributes.locationName === 'string' && attributes.locationName ? { 'data-activity-location': attributes.locationName } : {},
      },
      displayStatus: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-activity-display-status') || '',
        renderHTML: (attributes: { displayStatus?: unknown }) => typeof attributes.displayStatus === 'string' && attributes.displayStatus ? { 'data-activity-display-status': attributes.displayStatus } : {},
      },
      statusLabel: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-activity-status-label') || '',
        renderHTML: (attributes: { statusLabel?: unknown }) => typeof attributes.statusLabel === 'string' && attributes.statusLabel ? { 'data-activity-status-label': attributes.statusLabel } : {},
      },
      available: {
        default: true,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-activity-reference-available') !== 'false',
        renderHTML: (attributes: { available?: unknown }) => ({ 'data-activity-reference-available': attributes.available === false ? 'false' : 'true' }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-activity-reference]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const unavailable = node.attrs.available === false
    const title = unavailable ? '该引用活动已不可用' : typeof node.attrs.title === 'string' && node.attrs.title ? node.attrs.title : typeof node.attrs.titleSnapshot === 'string' && node.attrs.titleSnapshot ? node.attrs.titleSnapshot : '引用活动'
    const statusLabel = unavailable ? '' : typeof node.attrs.statusLabel === 'string' ? node.attrs.statusLabel : ''
    const coverUrl = typeof node.attrs.coverUrl === 'string' && node.attrs.coverUrl ? node.attrs.coverUrl : ''
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-activity-reference': 'true',
      class: `rich-text-activity-reference${unavailable ? ' is-unavailable' : ''}`,
      contenteditable: 'false',
      'aria-label': `引用活动：${title}`,
    }),
    ['span', { class: 'rich-text-activity-reference-icon', 'aria-hidden': 'true' }, coverUrl ? ['img', { src: coverUrl, alt: '', class: 'rich-text-reference-media' }] : '活动'],
    ['span', { class: 'rich-text-activity-reference-copy' },
      ['strong', {}, '引用活动'],
      ['span', {}, title],
      statusLabel ? ['small', {}, statusLabel] : '',
    ]]
  },
})

const richMaterialReference = TiptapNode.create({
  name: 'materialReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      materialId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-material-id'),
        renderHTML: (attributes: { materialId?: unknown }) => typeof attributes.materialId === 'string' && attributes.materialId ? { 'data-material-id': attributes.materialId } : {},
      },
      titleSnapshot: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-material-title-snapshot') || '',
        renderHTML: (attributes: { titleSnapshot?: unknown }) => typeof attributes.titleSnapshot === 'string' && attributes.titleSnapshot ? { 'data-material-title-snapshot': attributes.titleSnapshot } : {},
      },
      title: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-material-title') || '',
        renderHTML: (attributes: { title?: unknown }) => typeof attributes.title === 'string' && attributes.title ? { 'data-material-title': attributes.title } : {},
      },
      coverImageUrl: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-material-cover-url') || '',
        renderHTML: (attributes: { coverImageUrl?: unknown }) => typeof attributes.coverImageUrl === 'string' && attributes.coverImageUrl ? { 'data-material-cover-url': attributes.coverImageUrl } : {},
      },
      cost: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = Number(element.getAttribute('data-material-cost'))
          return Number.isSafeInteger(value) && value >= 0 ? value : null
        },
        renderHTML: (attributes: { cost?: unknown }) => Number.isSafeInteger(attributes.cost) ? { 'data-material-cost': String(attributes.cost) } : {},
      },
      stockRemaining: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = Number(element.getAttribute('data-material-stock'))
          return Number.isSafeInteger(value) && value >= 0 ? value : null
        },
        renderHTML: (attributes: { stockRemaining?: unknown }) => Number.isSafeInteger(attributes.stockRemaining) ? { 'data-material-stock': String(attributes.stockRemaining) } : {},
      },
      state: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-material-state') || '',
        renderHTML: (attributes: { state?: unknown }) => typeof attributes.state === 'string' && attributes.state ? { 'data-material-state': attributes.state } : {},
      },
      stateLabel: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-material-state-label') || '',
        renderHTML: (attributes: { stateLabel?: unknown }) => typeof attributes.stateLabel === 'string' && attributes.stateLabel ? { 'data-material-state-label': attributes.stateLabel } : {},
      },
      linkedActivityId: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-material-activity-id') || '',
        renderHTML: (attributes: { linkedActivityId?: unknown }) => typeof attributes.linkedActivityId === 'string' && attributes.linkedActivityId ? { 'data-material-activity-id': attributes.linkedActivityId } : {},
      },
      linkedActivityTitle: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-material-activity-title') || '',
        renderHTML: (attributes: { linkedActivityTitle?: unknown }) => typeof attributes.linkedActivityTitle === 'string' && attributes.linkedActivityTitle ? { 'data-material-activity-title': attributes.linkedActivityTitle } : {},
      },
      available: {
        default: true,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-material-reference-available') !== 'false',
        renderHTML: (attributes: { available?: unknown }) => ({ 'data-material-reference-available': attributes.available === false ? 'false' : 'true' }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-material-reference]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const unavailable = node.attrs.available === false
    const title = unavailable ? '该引用物料已不可用' : typeof node.attrs.title === 'string' && node.attrs.title ? node.attrs.title : typeof node.attrs.titleSnapshot === 'string' && node.attrs.titleSnapshot ? node.attrs.titleSnapshot : '引用物料'
    const stateLabel = unavailable ? '' : typeof node.attrs.stateLabel === 'string' ? node.attrs.stateLabel : ''
    const coverImageUrl = typeof node.attrs.coverImageUrl === 'string' && node.attrs.coverImageUrl ? node.attrs.coverImageUrl : ''
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-material-reference': 'true',
      class: `rich-text-material-reference${unavailable ? ' is-unavailable' : ''}`,
      contenteditable: 'false',
      'aria-label': `引用物料：${title}`,
    }),
    ['span', { class: 'rich-text-material-reference-icon', 'aria-hidden': 'true' }, coverImageUrl ? ['img', { src: coverImageUrl, alt: '', class: 'rich-text-reference-media' }] : '物料'],
    ['span', { class: 'rich-text-material-reference-copy' },
      ['strong', {}, '引用物料'],
      ['span', {}, title],
      stateLabel ? ['small', {}, stateLabel] : '',
    ]]
  },
})

const richUserMention = TiptapNode.create({
  name: 'userMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      userId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-user-id'),
        renderHTML: (attributes: { userId?: unknown }) => typeof attributes.userId === 'string' && attributes.userId ? { 'data-user-id': attributes.userId } : {},
      },
      displayName: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-user-display-name') || '',
        renderHTML: (attributes: { displayName?: unknown }) => typeof attributes.displayName === 'string' && attributes.displayName ? { 'data-user-display-name': attributes.displayName } : {},
      },
      uid: {
        default: null,
        parseHTML: (element: HTMLElement) => parseOptionalUid(element.getAttribute('data-user-uid')),
        renderHTML: (attributes: { uid?: unknown }) => Number.isSafeInteger(attributes.uid) ? { 'data-user-uid': String(attributes.uid) } : {},
      },
      available: {
        default: true,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-user-mention-available') !== 'false',
        renderHTML: (attributes: { available?: unknown }) => ({ 'data-user-mention-available': attributes.available === false ? 'false' : 'true' }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-user-mention]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const displayName = node.attrs.available === false
      ? '用户已不可用'
      : typeof node.attrs.displayName === 'string' && node.attrs.displayName ? node.attrs.displayName : '用户'
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-user-mention': 'true',
      class: 'rich-text-user-mention',
      contenteditable: 'false',
      'aria-label': `@${displayName}`,
    }), `@${displayName}`]
  },
})

const richTextExtensions = [
  Document,
  Paragraph,
  Text,
  HardBreak,
  Bold,
  RichSimpleMark({ name: 'italic', tag: 'em', commandName: 'italic' }),
  RichSimpleMark({ name: 'strike', tag: 's', commandName: 'strike' }),
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
  richMusicReference,
  richPostReference,
  richActivityReference,
  richMaterialReference,
  richUserMention,
]

type ProseMirrorDescendable = {
  descendants: (callback: (node: { type: { name: string } }) => boolean | void) => void
}

function countMusicReferencesInProseMirrorDocument(document: ProseMirrorDescendable) {
  let count = 0
  document.descendants((node) => {
    if (node.type.name === 'musicReference') count += 1
  })
  return count
}

function sanitizePastedHtml(html: string) {
  if (typeof window === 'undefined') return html
  const parsed = new window.DOMParser().parseFromString(html, 'text/html')
  const dangerousTags = new Set(['script', 'style', 'link', 'iframe', 'object', 'embed', 'meta', 'form', 'input', 'textarea', 'button', 'video', 'audio', 'img', 'svg', 'math'])
  const allowedTags = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 's', 'del', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'hr', 'a', 'code', 'pre', 'span'])
  const blockTags = new Set(['address', 'article', 'aside', 'div', 'dl', 'dt', 'dd', 'figcaption', 'figure', 'footer', 'header', 'main', 'nav', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr'])

  const escapeText = (value: string) => value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
  const escapeAttribute = (value: string) => escapeText(value).replace(/"/gu, '&quot;')
  const safeReferenceId = (value: string | null) => {
    const normalized = value?.trim() || ''
    return normalized && normalized.length <= 191 && !/[\u0000-\u001f\u007f\s]/u.test(normalized) ? normalized : null
  }
  const safeSnapshot = (value: string | null, fallback: string) => (value || fallback).trim().slice(0, 200)
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
      const postId = safeReferenceId(element.getAttribute('data-post-id'))
      if (element.hasAttribute('data-post-reference') && postId) {
        const title = safeSnapshot(element.getAttribute('data-post-title'), element.textContent || '引用帖子')
        const authorName = safeSnapshot(element.getAttribute('data-post-author-name'), '')
        const authorUid = element.getAttribute('data-post-author-uid')
        const referenceAttributes = [
          'data-post-reference="true"',
          'data-post-id="' + escapeAttribute(postId) + '"',
          title ? 'data-post-title="' + escapeAttribute(title) + '"' : '',
          authorName ? 'data-post-author-name="' + escapeAttribute(authorName) + '"' : '',
          authorUid && /^\d{1,5}$/u.test(authorUid) ? 'data-post-author-uid="' + authorUid + '"' : '',
          element.getAttribute('data-post-reference-available') === 'false' ? 'data-post-reference-available="false"' : '',
        ].filter(Boolean)
        return '<span ' + referenceAttributes.join(' ') + '>引用帖子</span>'
      }
      const activityId = safeReferenceId(element.getAttribute('data-activity-id'))
      if (element.hasAttribute('data-activity-reference') && activityId) {
        const title = safeSnapshot(element.getAttribute('data-activity-title-snapshot') || element.getAttribute('data-activity-title'), element.textContent || '引用活动')
        const referenceAttributes = [
          'data-activity-reference="true"',
          'data-activity-id="' + escapeAttribute(activityId) + '"',
          title ? 'data-activity-title-snapshot="' + escapeAttribute(title) + '"' : '',
        ].filter(Boolean)
        return '<span ' + referenceAttributes.join(' ') + '>引用活动</span>'
      }
      const materialId = safeReferenceId(element.getAttribute('data-material-id'))
      if (element.hasAttribute('data-material-reference') && materialId) {
        const title = safeSnapshot(element.getAttribute('data-material-title-snapshot') || element.getAttribute('data-material-title'), element.textContent || '引用物料')
        const referenceAttributes = [
          'data-material-reference="true"',
          'data-material-id="' + escapeAttribute(materialId) + '"',
          title ? 'data-material-title-snapshot="' + escapeAttribute(title) + '"' : '',
        ].filter(Boolean)
        return '<span ' + referenceAttributes.join(' ') + '>引用物料</span>'
      }
      const userId = safeReferenceId(element.getAttribute('data-user-id'))
      if (element.hasAttribute('data-user-mention') && userId) {
        const displayName = safeSnapshot(element.getAttribute('data-user-display-name'), (element.textContent || '').replace(/^@/u, '') || '用户')
        const uid = element.getAttribute('data-user-uid')
        const mentionAttributes = [
          'data-user-mention="true"',
          'data-user-id="' + escapeAttribute(userId) + '"',
          'data-user-display-name="' + escapeAttribute(displayName) + '"',
          uid && /^\d{1,5}$/u.test(uid) ? 'data-user-uid="' + uid + '"' : '',
          element.getAttribute('data-user-mention-available') === 'false' ? 'data-user-mention-available="false"' : '',
        ].filter(Boolean)
        return '<span ' + mentionAttributes.join(' ') + '>@' + escapeText(displayName) + '</span>'
      }
      const songId = element.getAttribute('data-music-song-id')
      if (element.hasAttribute('data-music-reference') && songId) {
        const title = (element.getAttribute('data-music-title') || element.textContent || '').replace(/^♪\s*/u, '').trim().slice(0, 200)
        const artist = (element.getAttribute('data-music-artist') || '').trim().slice(0, 200)
        const album = (element.getAttribute('data-music-album') || '').trim().slice(0, 200)
        const musicAttributes = [
          'data-music-reference="true"',
          'data-music-song-id="' + escapeAttribute(songId) + '"',
          title ? 'data-music-title="' + escapeAttribute(title) + '"' : '',
          artist ? 'data-music-artist="' + escapeAttribute(artist) + '"' : '',
          album ? 'data-music-album="' + escapeAttribute(album) + '"' : '',
        ].filter(Boolean)
        return '<span ' + musicAttributes.join(' ') + '>♪ ' + escapeText(title || '歌曲引用') + '</span>'
      }
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

function focusEditorWithoutScroll(editor: Editor) {
  // ProseMirror's EditorView.focus() uses focusPreventScroll and synchronizes
  // the current selection without scheduling a second browser focus pass.
  editor.view.focus()
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor({
  initialContent = '',
  initialRichContent,
  onChange,
  placeholder = '分享你的想法...',
}, ref) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const referenceTriggerRef = useRef<HTMLButtonElement>(null)
  const referenceMenuRef = useRef<HTMLDivElement>(null)
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const headingMenuOpenRef = useRef(false)
  const musicReferenceLimitCallbackRef = useRef<() => void>(() => undefined)
  const [initialDocument] = useState(() => initialEditorContent(initialRichContent, initialContent))
  // The active block type is a formatting snapshot.  Keep the heading menu's
  // visibility entirely interaction-driven so a selection or transaction can
  // never open it as a side effect.
  const [headingMenuOpen, setHeadingMenuOpen] = useState(false)
  const [activeHeadingLevel, setActiveHeadingLevel] = useState<HeadingLevel | undefined>(undefined)
  const [openMenu, setOpenMenu] = useState<'list' | 'size' | 'color' | 'reference' | null>(null)
  const [musicPickerOpen, setMusicPickerOpen] = useState(false)
  const [postReferencePickerOpen, setPostReferencePickerOpen] = useState(false)
  const [activityReferencePickerOpen, setActivityReferencePickerOpen] = useState(false)
  const [materialReferencePickerOpen, setMaterialReferencePickerOpen] = useState(false)
  const [userMentionPickerOpen, setUserMentionPickerOpen] = useState(false)
  const [editorNotice, setEditorNotice] = useState('')
  const [referenceMenuMobile, setReferenceMenuMobile] = useState(false)
  const [referenceMenuPosition, setReferenceMenuPosition] = useState<{ left: number; top: number } | null>(null)

  musicReferenceLimitCallbackRef.current = () => setEditorNotice(`每篇帖子最多引用 ${MAX_RICH_TEXT_MUSIC_REFERENCES} 首歌曲`)

  function rememberSelection(currentEditor: Editor) {
    const { from, to } = currentEditor.state.selection
    savedSelectionRef.current = { from, to }
  }

  function syncEditorSelection(currentEditor: Editor) {
    rememberSelection(currentEditor)
    const nextHeadingLevel = getActiveHeadingLevel(currentEditor)
    setActiveHeadingLevel((currentHeadingLevel) => currentHeadingLevel === nextHeadingLevel ? currentHeadingLevel : nextHeadingLevel)
  }

  const editorProps = useMemo(() => ({
    attributes: {
      class: 'rich-text-editor-surface',
      'aria-label': '帖子正文',
      spellcheck: 'true',
    },
    transformPastedHTML: sanitizePastedHtml,
    handlePaste: (view: unknown, _event: ClipboardEvent, slice: unknown) => {
      const editorView = view as { state: { doc: ProseMirrorDescendable } }
      const pastedSlice = slice as { content: ProseMirrorDescendable }
      const currentCount = countMusicReferencesInProseMirrorDocument(editorView.state.doc)
      const pastedCount = countMusicReferencesInProseMirrorDocument(pastedSlice.content)
      if (pastedCount > 0 && currentCount + pastedCount > MAX_RICH_TEXT_MUSIC_REFERENCES) {
        musicReferenceLimitCallbackRef.current()
        return true
      }
      return false
    },
  }), [])

  const editor = useEditor({
    extensions: richTextExtensions,
    content: initialDocument,
    immediatelyRender: false,
    editorProps,
    onCreate: ({ editor: createdEditor }) => {
      syncEditorSelection(createdEditor)
      const result = validateRichPostContent(createdEditor.getJSON())
      if (result.valid && countMusicReferenceNodes(result.value) > MAX_RICH_TEXT_MUSIC_REFERENCES) {
        setEditorNotice(`每篇帖子最多引用 ${MAX_RICH_TEXT_MUSIC_REFERENCES} 首歌曲，请删除多余引用后再保存`)
      }
      emitEditorChange(createdEditor, onChange)
    },
    onUpdate: ({ editor: updatedEditor }) => {
      syncEditorSelection(updatedEditor)
      const result = validateRichPostContent(updatedEditor.getJSON())
      if (result.valid && countMusicReferenceNodes(result.value) <= MAX_RICH_TEXT_MUSIC_REFERENCES) setEditorNotice('')
      emitEditorChange(updatedEditor, onChange)
    },
    onSelectionUpdate: ({ editor: selectedEditor }) => syncEditorSelection(selectedEditor),
  }, [])
  const inlineMarkState = useInlineMarkToolbarState(editor)

  const closeHeadingMenu = useCallback(() => {
    headingMenuOpenRef.current = false
    setHeadingMenuOpen(false)
  }, [])

  const closeReferenceMenuPosition = useCallback(() => {
    setReferenceMenuMobile(false)
    setReferenceMenuPosition(null)
  }, [])

  const closeToolbarMenus = useCallback(() => {
    closeHeadingMenu()
    setOpenMenu(null)
    closeReferenceMenuPosition()
  }, [closeHeadingMenu, closeReferenceMenuPosition])

  const updateReferenceMenuPosition = useCallback(() => {
    if (typeof window === 'undefined') return
    const trigger = referenceTriggerRef.current
    const isMobile = window.matchMedia('(max-width: 640px)').matches
    setReferenceMenuMobile(isMobile)
    if (!isMobile || !trigger) {
      setReferenceMenuPosition(null)
      return
    }

    const safeGap = 10
    const triggerRect = trigger.getBoundingClientRect()
    const menuRect = referenceMenuRef.current?.getBoundingClientRect()
    const maxWidth = Math.max(1, window.innerWidth - safeGap * 2)
    const menuWidth = Math.min(menuRect?.width || 160, maxWidth)
    const maxHeight = Math.max(1, window.innerHeight - safeGap * 2)
    const menuHeight = Math.min(menuRect?.height || 168, maxHeight)
    const left = Math.max(safeGap, Math.min(triggerRect.right - menuWidth, window.innerWidth - menuWidth - safeGap))
    let top = triggerRect.bottom + 4
    if (top + menuHeight > window.innerHeight - safeGap) top = triggerRect.top - menuHeight - 4
    top = Math.max(safeGap, Math.min(top, window.innerHeight - menuHeight - safeGap))
    setReferenceMenuPosition({ left, top })
  }, [])

  useLayoutEffect(() => {
    if (openMenu !== 'reference') return
    updateReferenceMenuPosition()
    window.addEventListener('resize', updateReferenceMenuPosition)
    window.addEventListener('scroll', updateReferenceMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateReferenceMenuPosition)
      window.removeEventListener('scroll', updateReferenceMenuPosition, true)
    }
  }, [openMenu, updateReferenceMenuPosition])

  useEffect(() => {
    if (!headingMenuOpen && !openMenu) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null
      if (!toolbarRef.current?.contains(target) && !referenceMenuRef.current?.contains(target)) closeToolbarMenus()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeToolbarMenus()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [closeToolbarMenus, headingMenuOpen, openMenu])

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (!editor) return
      focusEditorWithoutScroll(editor)
    },
    insertText: (text: string) => {
      if (!editor || !text) return
      const selection = savedSelectionRef.current
      if (selection) editor.commands.setTextSelection(selection)
      focusEditorWithoutScroll(editor)
      editor.chain().insertContent(text).run()
      rememberSelection(editor)
    },
  }), [editor])

  if (!editor) {
    return <div className="rich-text-editor-loading" aria-live="polite">正在加载编辑器…</div>
  }

  const activeEditor = editor
  const {
    bold: boldActive,
    italic: italicActive,
    strike: strikeActive,
    bulletList: bulletListActive,
    orderedList: orderedListActive,
    fontSize: currentSize,
    textColor: currentColor,
  } = inlineMarkState
  const currentBlockType: 'paragraph' | HeadingLevel = activeHeadingLevel ?? 'paragraph'
  const blockLabel = blockLabels[currentBlockType]
  const stopToolbarBlur = (event: MouseEvent<HTMLButtonElement>) => {
    rememberSelection(activeEditor)
    event.preventDefault()
  }
  const rememberToolbarPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    rememberSelection(activeEditor)
    event.preventDefault()
  }
  const closeHeadingOnToolbarMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    stopToolbarBlur(event)
    closeHeadingMenu()
  }

  function restoreSavedSelection() {
    const selection = savedSelectionRef.current
    if (!selection) return
    const maxPosition = activeEditor.state.doc.content.size
    const from = Math.max(1, Math.min(selection.from, maxPosition))
    const to = Math.max(from, Math.min(selection.to, maxPosition))
    const currentSelection = activeEditor.state.selection
    if (currentSelection.from === from && currentSelection.to === to) return
    activeEditor.commands.setTextSelection({ from, to })
  }

  function startCommand() {
    restoreSavedSelection()
    focusEditorWithoutScroll(activeEditor)
    return activeEditor.chain()
  }

  function toggleHeadingMenuFromUser() {
    rememberSelection(activeEditor)
    setOpenMenu(null)
    const nextOpen = !headingMenuOpenRef.current
    headingMenuOpenRef.current = nextOpen
    setHeadingMenuOpen(nextOpen)
  }

  function handleHeadingTriggerPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    toggleHeadingMenuFromUser()
  }

  function handleHeadingTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()
    toggleHeadingMenuFromUser()
  }

  function toggleToolbarMenu(menu: 'list' | 'size' | 'color') {
    rememberSelection(activeEditor)
    closeHeadingMenu()
    setOpenMenu((current) => current === menu ? null : menu)
  }

  function toggleReferenceMenu() {
    rememberSelection(activeEditor)
    closeHeadingMenu()
    const nextOpen = openMenu !== 'reference'
    if (nextOpen) updateReferenceMenuPosition()
    else closeReferenceMenuPosition()
    setOpenMenu(nextOpen ? 'reference' : null)
  }

  function openReferencePicker(kind: 'post' | 'activity' | 'material' | 'music') {
    rememberSelection(activeEditor)
    closeHeadingMenu()
    setOpenMenu(null)
    closeReferenceMenuPosition()
    if (kind === 'music') {
      const result = validateRichPostContent(activeEditor.getJSON())
      if (result.valid && countMusicReferenceNodes(result.value) >= MAX_RICH_TEXT_MUSIC_REFERENCES) {
        setEditorNotice(`每篇帖子最多引用 ${MAX_RICH_TEXT_MUSIC_REFERENCES} 首歌曲`)
        setMusicPickerOpen(false)
        return
      }
    }
    setMusicPickerOpen(kind === 'music')
    setPostReferencePickerOpen(kind === 'post')
    setActivityReferencePickerOpen(kind === 'activity')
    setMaterialReferencePickerOpen(kind === 'material')
  }

  function applySize(token: RichTextFontSizeToken) {
    startCommand().setMark('fontSize', { token }).run()
    closeHeadingMenu()
    setOpenMenu(null)
  }

  function applyColor(token: RichTextColorToken) {
    if (token === 'default') startCommand().unsetMark('textColor').run()
    else startCommand().setMark('textColor', { token }).run()
    closeHeadingMenu()
    setOpenMenu(null)
  }

  function applyBlock(level: 'paragraph' | 1 | 2 | 3) {
    if (level === 'paragraph') startCommand().setNode('paragraph').run()
    else startCommand().setNode('heading', { level }).run()
    closeHeadingMenu()
    setOpenMenu(null)
  }

  function toggleInlineMark(mark: 'bold' | 'italic' | 'strike') {
    closeHeadingMenu()
    restoreSavedSelection()
    if (mark === 'bold') {
      activeEditor.chain().focus(null, { scrollIntoView: false }).toggleBold().run()
      return
    }
    if (mark === 'italic') {
      activeEditor.chain().focus(null, { scrollIntoView: false }).toggleItalic().run()
      return
    }
    activeEditor.chain().focus(null, { scrollIntoView: false }).toggleStrike().run()
  }

  function applyList(listType: 'bulletList' | 'orderedList') {
    if (listType === 'bulletList') startCommand().toggleBulletList().run()
    else startCommand().toggleOrderedList().run()
    closeHeadingMenu()
    setOpenMenu(null)
  }

  function clearFormatting() {
    startCommand().unsetAllMarks().setNode('paragraph').run()
    closeHeadingMenu()
    setOpenMenu(null)
  }

  function insertMusicReference(song: MusicReferenceSong) {
    closeHeadingMenu()
    const result = validateRichPostContent(activeEditor.getJSON())
    if (result.valid && countMusicReferenceNodes(result.value) >= MAX_RICH_TEXT_MUSIC_REFERENCES) {
      setEditorNotice(`每篇帖子最多引用 ${MAX_RICH_TEXT_MUSIC_REFERENCES} 首歌曲`)
      setMusicPickerOpen(false)
      return
    }
    startCommand()
      .insertContent({
        type: 'musicReference',
        attrs: {
          songId: song.id,
          title: song.title,
          artist: song.artist || song.album.artist || '',
          album: song.album.name,
        },
      })
      .insertContent(' ')
      .run()
    rememberSelection(activeEditor)
    setEditorNotice('')
    setMusicPickerOpen(false)
  }

  function insertPostReference(post: PostReferencePost) {
    closeHeadingMenu()
    startCommand()
      .insertContent({
        type: 'postReference',
        attrs: {
          postId: post.id,
          title: post.title,
          authorName: post.authorName,
          authorUid: post.authorUid,
          available: true,
        },
      })
      .insertContent(' ')
      .run()
    rememberSelection(activeEditor)
    setPostReferencePickerOpen(false)
  }

  function insertActivityReference(activity: ActivityReferenceActivity) {
    closeHeadingMenu()
    startCommand()
      .insertContent({
        type: 'activityReference',
        attrs: {
          activityId: activity.id,
          titleSnapshot: activity.title,
          ...(activity.coverUrl ? { coverUrl: activity.coverUrl } : {}),
          ...(activity.bannerUrl ? { bannerUrl: activity.bannerUrl } : {}),
          ...(activity.startsAt ? { startsAt: activity.startsAt } : {}),
          ...(activity.endsAt ? { endsAt: activity.endsAt } : {}),
          ...(activity.locationName ? { locationName: activity.locationName } : {}),
          displayStatus: activity.displayStatus,
          statusLabel: activity.statusLabel,
        },
      })
      .insertContent(' ')
      .run()
    rememberSelection(activeEditor)
    setActivityReferencePickerOpen(false)
  }

  function insertMaterialReference(material: MaterialReferenceMaterial) {
    closeHeadingMenu()
    startCommand()
      .insertContent({
        type: 'materialReference',
        attrs: {
          materialId: material.id,
          titleSnapshot: material.title,
          ...(material.coverImageUrl ? { coverImageUrl: material.coverImageUrl } : {}),
          cost: material.cost,
          stockRemaining: material.stockRemaining,
          state: material.state,
          stateLabel: material.stateLabel,
          ...(material.linkedActivity ? { linkedActivityId: material.linkedActivity.id, linkedActivityTitle: material.linkedActivity.title } : {}),
        },
      })
      .insertContent(' ')
      .run()
    rememberSelection(activeEditor)
    setMaterialReferencePickerOpen(false)
  }

  function insertUserMention(user: UserMentionUser) {
    closeHeadingMenu()
    startCommand()
      .insertContent({
        type: 'userMention',
        attrs: {
          userId: user.id,
          displayName: user.displayName,
          uid: user.uid,
          available: true,
        },
      })
      .insertContent(' ')
      .run()
    rememberSelection(activeEditor)
    setUserMentionPickerOpen(false)
  }

  const referenceMenu = (
    <ReferenceMenu
      referenceMenuRef={referenceMenuRef}
      mobile={referenceMenuMobile}
      position={referenceMenuPosition}
      onPointerDown={rememberToolbarPointerDown}
      onMouseDown={closeHeadingOnToolbarMouseDown}
      onPost={() => openReferencePicker('post')}
      onActivity={() => openReferencePicker('activity')}
      onMaterial={() => openReferencePicker('material')}
      onMusic={() => openReferencePicker('music')}
    />
  )

  return (
    <div className="rich-text-editor-shell">
      <div ref={toolbarRef} className="rich-text-toolbar" aria-label="正文排版工具栏">
        <div className="rich-text-toolbar-row rich-text-toolbar-row-primary">
        <div className="relative rich-text-toolbar-dropdown rich-text-toolbar-dropdown-heading">
          <button
            type="button"
            className={toolbarButtonClass(Boolean(activeHeadingLevel))}
            aria-haspopup="menu"
            aria-expanded={headingMenuOpen}
            aria-controls="rich-text-heading-menu"
            onPointerDown={handleHeadingTriggerPointerDown}
            onKeyDown={handleHeadingTriggerKeyDown}
          >
            <span className="rich-text-toolbar-label">{blockLabel}</span><span aria-hidden="true">⌄</span>
          </button>
          {headingMenuOpen ? (
            <div id="rich-text-heading-menu" className="rich-text-toolbar-menu" role="menu" aria-label="段落样式">
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
                  className={menuItemClass(value === currentBlockType)}
                  onPointerDown={rememberToolbarPointerDown}
                  onMouseDown={stopToolbarBlur}
                  onClick={() => applyBlock(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="relative rich-text-toolbar-dropdown rich-text-toolbar-dropdown-size">
          <button
            type="button"
            className={toolbarButtonClass(Boolean(currentSize))}
            aria-haspopup="menu"
            aria-expanded={openMenu === 'size'}
            onMouseDown={closeHeadingOnToolbarMouseDown}
            onClick={() => toggleToolbarMenu('size')}
          >
            <span className="rich-text-toolbar-label">字号</span><span aria-hidden="true">⌄</span>
          </button>
          {openMenu === 'size' ? (
            <div className="rich-text-toolbar-menu" role="menu" aria-label="字号">
              {RICH_TEXT_FONT_SIZE_TOKENS.map((token) => (
                <button
                  type="button"
                  role="menuitem"
                  key={token}
                  className={menuItemClass(currentSize === token)}
                  onPointerDown={rememberToolbarPointerDown}
                  onMouseDown={closeHeadingOnToolbarMouseDown}
                  onClick={() => applySize(token)}
                >
                  {fontSizeLabels[token]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="relative rich-text-toolbar-dropdown rich-text-toolbar-dropdown-color">
          <button
            type="button"
            className={toolbarButtonClass(Boolean(currentColor))}
            aria-haspopup="menu"
            aria-expanded={openMenu === 'color'}
            onMouseDown={closeHeadingOnToolbarMouseDown}
            onClick={() => toggleToolbarMenu('color')}
          >
            <span className="rich-text-color-trigger">A</span>
            <span className="rich-text-toolbar-label">{currentColor ? colorLabels[currentColor] : '颜色'}</span>
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
                  onPointerDown={rememberToolbarPointerDown}
                  onMouseDown={closeHeadingOnToolbarMouseDown}
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
          className={toolbarButtonClass(boldActive)}
          aria-label="加粗"
          aria-pressed={boldActive}
          data-active={boldActive ? 'true' : 'false'}
          onPointerDown={rememberToolbarPointerDown}
          onMouseDown={closeHeadingOnToolbarMouseDown}
          onClick={() => toggleInlineMark('bold')}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className={toolbarButtonClass(italicActive)}
          aria-label="斜体"
          aria-pressed={italicActive}
          data-active={italicActive ? 'true' : 'false'}
          onPointerDown={rememberToolbarPointerDown}
          onMouseDown={closeHeadingOnToolbarMouseDown}
          onClick={() => toggleInlineMark('italic')}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className={toolbarButtonClass(strikeActive)}
          aria-label="删除线"
          data-active={strikeActive ? 'true' : 'false'}
          aria-pressed={strikeActive}
          onPointerDown={rememberToolbarPointerDown}
          onMouseDown={closeHeadingOnToolbarMouseDown}
          onClick={() => toggleInlineMark('strike')}
        >
          <s>S</s>
        </button>

        <div className="relative rich-text-toolbar-dropdown rich-text-toolbar-dropdown-list">
          <button
            type="button"
            className={toolbarButtonClass(bulletListActive || orderedListActive)}
            aria-label="列表"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'list'}
            aria-pressed={bulletListActive || orderedListActive}
            onPointerDown={rememberToolbarPointerDown}
            onMouseDown={closeHeadingOnToolbarMouseDown}
            onClick={() => toggleToolbarMenu('list')}
          >
            <span className="rich-text-toolbar-label">列表</span><span aria-hidden="true">⌄</span>
          </button>
          {openMenu === 'list' ? (
            <div className="rich-text-toolbar-menu" role="menu" aria-label="列表类型">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={bulletListActive}
                className={menuItemClass(bulletListActive)}
                onPointerDown={rememberToolbarPointerDown}
                onMouseDown={closeHeadingOnToolbarMouseDown}
                onClick={() => applyList('bulletList')}
              >
                <span aria-hidden="true">{bulletListActive ? '✓' : ''}</span>无序列表
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={orderedListActive}
                className={menuItemClass(orderedListActive)}
                onPointerDown={rememberToolbarPointerDown}
                onMouseDown={closeHeadingOnToolbarMouseDown}
                onClick={() => applyList('orderedList')}
              >
                <span aria-hidden="true">{orderedListActive ? '✓' : ''}</span>有序列表
              </button>
            </div>
          ) : null}
        </div>
        </div>
        <div className="rich-text-toolbar-row rich-text-toolbar-row-secondary">
        <div className="relative rich-text-toolbar-dropdown rich-text-toolbar-dropdown-reference">
          <button
            type="button"
            className={toolbarButtonClass()}
            ref={referenceTriggerRef}
            aria-label="引用"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'reference'}
            onPointerDown={rememberToolbarPointerDown}
            onMouseDown={closeHeadingOnToolbarMouseDown}
            onClick={toggleReferenceMenu}
          >
            引用 <span aria-hidden="true">⌄</span>
          </button>
          {openMenu === 'reference' ? referenceMenuMobile && typeof document !== 'undefined' ? createPortal(referenceMenu, document.body) : referenceMenu : null}
        </div>
        <button
          type="button"
          className={toolbarButtonClass()}
          aria-label="@用户"
          onPointerDown={rememberToolbarPointerDown}
          onMouseDown={closeHeadingOnToolbarMouseDown}
          onClick={() => {
            rememberSelection(activeEditor)
            setOpenMenu(null)
            setUserMentionPickerOpen(true)
          }}
        >
          @用户
        </button>
        <button
          type="button"
          className={toolbarButtonClass()}
          aria-label="插入分割线"
          onMouseDown={closeHeadingOnToolbarMouseDown}
          onClick={() => {
            closeHeadingMenu()
            startCommand().insertContent({ type: 'horizontalRule' }).run()
          }}
        >
          分割线
        </button>

        <button
          type="button"
          className={toolbarButtonClass()}
          onMouseDown={closeHeadingOnToolbarMouseDown}
          onClick={clearFormatting}
        >
          清除格式
        </button>
        <button
          type="button"
          className={toolbarButtonClass()}
          aria-label="撤销"
          disabled={!activeEditor.can().undo()}
          onMouseDown={closeHeadingOnToolbarMouseDown}
          onClick={() => {
            closeHeadingMenu()
            startCommand().undo().run()
          }}
        >
          ↶ <span className="sr-only">撤销</span>
        </button>
        <button
          type="button"
          className={toolbarButtonClass()}
          aria-label="重做"
          disabled={!activeEditor.can().redo()}
          onMouseDown={closeHeadingOnToolbarMouseDown}
          onClick={() => {
            closeHeadingMenu()
            startCommand().redo().run()
          }}
        >
          ↷ <span className="sr-only">重做</span>
        </button>
        </div>
      </div>
      {editorNotice ? <p className="rich-text-toolbar-notice" role="status">{editorNotice}</p> : null}
      <EditorContent
        editor={editor}
        className="rich-text-editor-content"
        data-placeholder={placeholder}
        onFocus={closeToolbarMenus}
        onBlur={closeToolbarMenus}
        onCompositionStart={closeToolbarMenus}
        onCompositionUpdate={closeToolbarMenus}
        onCompositionEnd={closeToolbarMenus}
      />
      <MusicReferencePicker
        open={musicPickerOpen}
        onClose={() => setMusicPickerOpen(false)}
        onSelect={insertMusicReference}
      />
      <PostReferencePicker
        open={postReferencePickerOpen}
        onClose={() => setPostReferencePickerOpen(false)}
        onSelect={insertPostReference}
      />
      <ActivityReferencePicker
        open={activityReferencePickerOpen}
        onClose={() => setActivityReferencePickerOpen(false)}
        onSelect={insertActivityReference}
      />
      <MaterialReferencePicker
        open={materialReferencePickerOpen}
        onClose={() => setMaterialReferencePickerOpen(false)}
        onSelect={insertMaterialReference}
      />
      <UserMentionPicker
        open={userMentionPickerOpen}
        onClose={() => setUserMentionPickerOpen(false)}
        onSelect={insertUserMention}
      />
    </div>
  )
})

type ReferenceMenuProps = {
  referenceMenuRef: React.Ref<HTMLDivElement>
  mobile: boolean
  position: { left: number; top: number } | null
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void
  onPost: () => void
  onActivity: () => void
  onMaterial: () => void
  onMusic: () => void
}

function ReferenceMenu({
  referenceMenuRef,
  mobile,
  position,
  onPointerDown,
  onMouseDown,
  onPost,
  onActivity,
  onMaterial,
  onMusic,
}: Readonly<ReferenceMenuProps>) {
  return (
    <div
      ref={referenceMenuRef}
      className={`rich-text-toolbar-menu${mobile ? ' rich-text-reference-menu-viewport' : ''}`}
      role="menu"
      aria-label="引用类型"
      style={mobile && position ? { left: `${position.left}px`, top: `${position.top}px` } : undefined}
    >
      <button
        type="button"
        role="menuitem"
        aria-label="引用一篇站内帖子"
        className={menuItemClass()}
        onPointerDown={onPointerDown}
        onMouseDown={onMouseDown}
        onClick={onPost}
      >
        引用帖子
      </button>
      <button
        type="button"
        role="menuitem"
        aria-label="引用一场活动"
        className={menuItemClass()}
        onPointerDown={onPointerDown}
        onMouseDown={onMouseDown}
        onClick={onActivity}
      >
        引用活动
      </button>
      <button
        type="button"
        role="menuitem"
        aria-label="引用一个物料"
        className={menuItemClass()}
        onPointerDown={onPointerDown}
        onMouseDown={onMouseDown}
        onClick={onMaterial}
      >
        引用物料
      </button>
      <button
        type="button"
        role="menuitem"
        aria-label="引用 EasMusic 歌曲"
        className={menuItemClass()}
        onPointerDown={onPointerDown}
        onMouseDown={onMouseDown}
        onClick={onMusic}
      >
        引用歌曲
      </button>
    </div>
  )
}
