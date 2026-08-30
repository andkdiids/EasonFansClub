export const RICH_TEXT_COLOR_TOKENS = [
  'default',
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'pink',
] as const

export type RichTextColorToken = (typeof RICH_TEXT_COLOR_TOKENS)[number]

export const RICH_TEXT_FONT_SIZE_TOKENS = ['small', 'normal', 'large', 'title'] as const

export type RichTextFontSizeToken = (typeof RICH_TEXT_FONT_SIZE_TOKENS)[number]

export const MAX_POST_PLAIN_TEXT_LENGTH = 20_000
export const MAX_RICH_TEXT_JSON_LENGTH = 256_000
export const MAX_RICH_TEXT_NODES = 4_000
export const MAX_RICH_TEXT_DEPTH = 12
export const MAX_RICH_TEXT_MARKS_PER_TEXT = 6

export type RichTextMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'link'; attrs: { href: string } }
  | { type: 'textColor'; attrs: { token: RichTextColorToken } }
  | { type: 'fontSize'; attrs: { token: RichTextFontSizeToken } }

export type RichTextInlineNode =
  | { type: 'text'; text: string; marks?: RichTextMark[] }
  | { type: 'hardBreak' }
  | RichTextMusicReferenceNode

export type RichTextMusicReferenceNode = {
  type: 'musicReference'
  attrs: {
    songId: string
    title?: string
    artist?: string
    album?: string
  }
}

export type RichTextParagraphNode = {
  type: 'paragraph'
  content?: RichTextInlineNode[]
}

export type RichTextHeadingNode = {
  type: 'heading'
  attrs: { level: 1 | 2 | 3 }
  content?: RichTextInlineNode[]
}

export type RichTextListItemNode = {
  type: 'listItem'
  content?: RichTextBlockNode[]
}

export type RichTextBulletListNode = {
  type: 'bulletList'
  content?: RichTextListItemNode[]
}

export type RichTextOrderedListNode = {
  type: 'orderedList'
  attrs?: { start: number }
  content?: RichTextListItemNode[]
}

export type RichTextBlockquoteNode = {
  type: 'blockquote'
  content?: RichTextBlockNode[]
}

export type RichTextHorizontalRuleNode = {
  type: 'horizontalRule'
}

export type RichTextCodeBlockNode = {
  type: 'codeBlock'
  content?: Array<{ type: 'text'; text: string }>
}

export type RichTextBlockNode =
  | RichTextParagraphNode
  | RichTextHeadingNode
  | RichTextBulletListNode
  | RichTextOrderedListNode
  | RichTextListItemNode
  | RichTextBlockquoteNode
  | RichTextHorizontalRuleNode
  | RichTextCodeBlockNode

export type RichTextContent = {
  type: 'doc'
  content: RichTextBlockNode[]
}

export function isRichTextColorToken(value: unknown): value is RichTextColorToken {
  return typeof value === 'string' && (RICH_TEXT_COLOR_TOKENS as readonly string[]).includes(value)
}

export function isRichTextFontSizeToken(value: unknown): value is RichTextFontSizeToken {
  return typeof value === 'string' && (RICH_TEXT_FONT_SIZE_TOKENS as readonly string[]).includes(value)
}

/**
 * Normalize a user-entered URL to a protocol that the renderer can safely
 * expose. Relative links remain available for internal forum navigation.
 */
export function normalizeRichTextHref(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/[\u0000-\u001f\u007f]/gu, '')
  if (!raw) return null
  if (/["'<>\s]/u.test(raw)) return null
  if (/^(?:javascript|data|vbscript|file|about):/iu.test(raw)) return null
  if (raw.startsWith('//')) return 'https:' + raw
  if (raw.startsWith('/') || raw.startsWith('#') || raw.startsWith('?')) return raw

  const candidate = /^https?:\/\//iu.test(raw) ? raw : 'https://' + raw
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

type ValidationState = {
  errors: string[]
  nodeCount: number
}

export type RichTextValidationResult =
  | { valid: true; value: RichTextContent; plainText: string }
  | { valid: false; errors: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function fail(state: ValidationState, message: string) {
  if (state.errors.length < 8) state.errors.push(message)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function countNode(state: ValidationState, path: string) {
  state.nodeCount += 1
  if (state.nodeCount > MAX_RICH_TEXT_NODES) {
    fail(state, path + ' contains too many nodes')
    return false
  }
  return true
}

function normalizeMarks(value: unknown, state: ValidationState, path: string): RichTextMark[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    fail(state, path + '.marks must be an array')
    return null
  }
  if (value.length > MAX_RICH_TEXT_MARKS_PER_TEXT) {
    fail(state, path + '.marks contains too many marks')
    return null
  }

  const marks: RichTextMark[] = []
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const mark = value[index]
    if (!isRecord(mark) || typeof mark.type !== 'string') {
      fail(state, path + '.marks[' + index + '] is invalid')
      continue
    }
    if (seen.has(mark.type)) {
      fail(state, path + '.marks[' + index + '] is duplicated')
      continue
    }
    seen.add(mark.type)

    if (mark.type === 'bold' || mark.type === 'italic' || mark.type === 'strike' || mark.type === 'code') {
      if (!hasOnlyKeys(mark, ['type'])) fail(state, path + '.marks[' + index + '] has unknown attributes')
      marks.push({ type: mark.type })
      continue
    }
    if (mark.type === 'link') {
      if (!hasOnlyKeys(mark, ['type', 'attrs']) || !isRecord(mark.attrs) || !hasOnlyKeys(mark.attrs, ['href'])) {
        fail(state, path + '.marks[' + index + '] has invalid link attributes')
        continue
      }
      const href = normalizeRichTextHref(mark.attrs.href)
      if (!href) {
        fail(state, path + '.marks[' + index + '] has an unsafe link')
        continue
      }
      marks.push({ type: 'link', attrs: { href } })
      continue
    }
    if (mark.type === 'textColor') {
      if (!hasOnlyKeys(mark, ['type', 'attrs']) || !isRecord(mark.attrs) || !hasOnlyKeys(mark.attrs, ['token']) || !isRichTextColorToken(mark.attrs.token)) {
        fail(state, path + '.marks[' + index + '] has an invalid color token')
        continue
      }
      marks.push({ type: 'textColor', attrs: { token: mark.attrs.token } })
      continue
    }
    if (mark.type === 'fontSize') {
      if (!hasOnlyKeys(mark, ['type', 'attrs']) || !isRecord(mark.attrs) || !hasOnlyKeys(mark.attrs, ['token']) || !isRichTextFontSizeToken(mark.attrs.token)) {
        fail(state, path + '.marks[' + index + '] has an invalid font-size token')
        continue
      }
      marks.push({ type: 'fontSize', attrs: { token: mark.attrs.token } })
      continue
    }

    fail(state, path + '.marks[' + index + '] uses an unsupported mark')
  }

  return state.errors.length ? null : marks
}

function normalizeInlineNode(value: unknown, state: ValidationState, depth: number, path: string): RichTextInlineNode | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    fail(state, path + ' is invalid')
    return null
  }
  if (depth > MAX_RICH_TEXT_DEPTH) {
    fail(state, path + ' is too deeply nested')
    return null
  }
  if (!countNode(state, path)) return null

  if (value.type === 'hardBreak') {
    if (!hasOnlyKeys(value, ['type'])) fail(state, path + ' has unknown attributes')
    return { type: 'hardBreak' }
  }
  if (value.type === 'musicReference') {
    if (!hasOnlyKeys(value, ['type', 'attrs']) || !isRecord(value.attrs) || !hasOnlyKeys(value.attrs, ['songId', 'title', 'artist', 'album'])) {
      fail(state, path + ' has invalid music reference attributes')
      return null
    }
    const attrs = value.attrs
    const songId = typeof attrs.songId === 'string' ? attrs.songId.trim() : ''
    if (!songId || songId.length > 191 || /[\u0000-\u001f\u007f\s]/u.test(songId)) {
      fail(state, path + '.attrs.songId is invalid')
      return null
    }
    const metadata: RichTextMusicReferenceNode['attrs'] = { songId }
    for (const key of ['title', 'artist', 'album'] as const) {
      const valueForKey = attrs[key]
      if (valueForKey === undefined) continue
      if (typeof valueForKey !== 'string' || valueForKey.length > 200) {
        fail(state, path + '.attrs.' + key + ' is invalid')
        return null
      }
      const trimmed = valueForKey.trim()
      if (trimmed) metadata[key] = trimmed
    }
    return { type: 'musicReference', attrs: metadata }
  }
  if (value.type !== 'text' || typeof value.text !== 'string' || value.text.length === 0) {
    fail(state, path + ' uses an unsupported inline node')
    return null
  }
  if (!hasOnlyKeys(value, ['type', 'text', 'marks'])) fail(state, path + ' has unknown attributes')
  const marks = normalizeMarks(value.marks, state, path)
  if (marks === null) return null
  return marks.length ? { type: 'text', text: value.text, marks } : { type: 'text', text: value.text }
}

function normalizeInlineContent(value: unknown, state: ValidationState, depth: number, path: string) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    fail(state, path + '.content must be an array')
    return null
  }
  const content: RichTextInlineNode[] = []
  for (let index = 0; index < value.length; index += 1) {
    const child = normalizeInlineNode(value[index], state, depth + 1, path + '.content[' + index + ']')
    if (child) content.push(child)
  }
  return content
}

function normalizeParagraph(value: Record<string, unknown>, state: ValidationState, depth: number, path: string): RichTextParagraphNode | null {
  if (!hasOnlyKeys(value, ['type', 'content'])) fail(state, path + ' has unknown attributes')
  const content = normalizeInlineContent(value.content, state, depth, path)
  if (content === null) return null
  return content?.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

function normalizeHeading(value: Record<string, unknown>, state: ValidationState, depth: number, path: string): RichTextHeadingNode | null {
  if (!hasOnlyKeys(value, ['type', 'attrs', 'content'])) fail(state, path + ' has unknown attributes')
  const attrs = value.attrs === undefined ? { level: 1 } : value.attrs
  if (!isRecord(attrs) || !hasOnlyKeys(attrs, ['level']) || ![1, 2, 3].includes(attrs.level as number)) {
    fail(state, path + '.attrs.level must be 1, 2 or 3')
    return null
  }
  const content = normalizeInlineContent(value.content, state, depth, path)
  if (content === null) return null
  return content?.length
    ? { type: 'heading', attrs: { level: attrs.level as 1 | 2 | 3 }, content }
    : { type: 'heading', attrs: { level: attrs.level as 1 | 2 | 3 } }
}

function normalizeBlockArray(value: unknown, state: ValidationState, depth: number, path: string, itemOnly = false): RichTextBlockNode[] | null | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    fail(state, path + '.content must be an array')
    return null
  }
  const content: RichTextBlockNode[] = []
  for (let index = 0; index < value.length; index += 1) {
    const child = normalizeBlockNode(value[index], state, depth + 1, path + '.content[' + index + ']', itemOnly)
    if (child) content.push(child)
  }
  return content
}

function normalizeListItems(value: unknown, state: ValidationState, depth: number, path: string) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    fail(state, path + '.content must be an array')
    return null
  }
  const content: RichTextListItemNode[] = []
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (!isRecord(item) || item.type !== 'listItem') {
      fail(state, path + '.content[' + index + '] must be a listItem')
      continue
    }
    const normalized = normalizeBlockNode(item, state, depth + 1, path + '.content[' + index + ']', true)
    if (normalized?.type === 'listItem') content.push(normalized)
  }
  return content
}

function normalizeBlockNode(value: unknown, state: ValidationState, depth: number, path: string, itemOnly = false): RichTextBlockNode | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    fail(state, path + ' is invalid')
    return null
  }
  if (depth > MAX_RICH_TEXT_DEPTH) {
    fail(state, path + ' is too deeply nested')
    return null
  }
  if (!countNode(state, path)) return null

  if (value.type === 'paragraph') return normalizeParagraph(value, state, depth, path)
  if (value.type === 'heading') return normalizeHeading(value, state, depth, path)
  if (value.type === 'bulletList' || value.type === 'orderedList') {
    if (itemOnly) {
      fail(state, path + ' cannot be nested directly in a list item')
      return null
    }
    const allowed = value.type === 'orderedList' ? ['type', 'attrs', 'content'] : ['type', 'content']
    if (!hasOnlyKeys(value, allowed)) fail(state, path + ' has unknown attributes')
    let attrs: { start: number } | undefined
    if (value.type === 'orderedList') {
      if (value.attrs === undefined) attrs = { start: 1 }
      else if (isRecord(value.attrs) && hasOnlyKeys(value.attrs, ['start']) && Number.isSafeInteger(value.attrs.start) && (value.attrs.start as number) >= 1 && (value.attrs.start as number) <= 100_000) {
        attrs = { start: value.attrs.start as number }
      } else {
        fail(state, path + '.attrs.start is invalid')
        return null
      }
    }
    const content = normalizeListItems(value.content, state, depth, path)
    if (content === null) return null
    if (value.type === 'orderedList') return content?.length ? { type: 'orderedList', attrs, content } : { type: 'orderedList', attrs }
    return content?.length ? { type: 'bulletList', content } : { type: 'bulletList' }
  }
  if (value.type === 'listItem') {
    if (!itemOnly) {
      fail(state, path + ' is only valid inside a list')
      return null
    }
    if (!hasOnlyKeys(value, ['type', 'content'])) fail(state, path + ' has unknown attributes')
    const content = normalizeBlockArray(value.content, state, depth, path)
    if (content === null) return null
    return content?.length ? { type: 'listItem', content } : { type: 'listItem' }
  }
  if (value.type === 'blockquote') {
    if (!hasOnlyKeys(value, ['type', 'content'])) fail(state, path + ' has unknown attributes')
    const content = normalizeBlockArray(value.content, state, depth, path)
    if (content === null) return null
    return content?.length ? { type: 'blockquote', content } : { type: 'blockquote' }
  }
  if (value.type === 'horizontalRule') {
    if (!hasOnlyKeys(value, ['type'])) fail(state, path + ' has unknown attributes')
    return { type: 'horizontalRule' }
  }
  if (value.type === 'codeBlock') {
    if (!hasOnlyKeys(value, ['type', 'content'])) fail(state, path + ' has unknown attributes')
    if (value.content === undefined) return { type: 'codeBlock' }
    if (!Array.isArray(value.content)) {
      fail(state, path + '.content must be an array')
      return null
    }
    const content: Array<{ type: 'text'; text: string }> = []
    for (let index = 0; index < value.content.length; index += 1) {
      const child = value.content[index]
      if (!isRecord(child) || child.type !== 'text' || typeof child.text !== 'string' || !hasOnlyKeys(child, ['type', 'text'])) {
        fail(state, path + '.content[' + index + '] must be plain text')
        continue
      }
      if (!countNode(state, path + '.content[' + index + ']')) continue
      content.push({ type: 'text', text: child.text })
    }
    return { type: 'codeBlock', content }
  }

  fail(state, path + ' uses an unsupported block node')
  return null
}

function extractInlineText(content: RichTextInlineNode[] | undefined) {
  return (content || []).map((node) => {
    if (node.type === 'hardBreak') return '\n'
    if (node.type === 'musicReference') return node.attrs.title || ''
    return node.text
  }).join('')
}

function extractBlockText(block: RichTextBlockNode): string {
  if (block.type === 'paragraph' || block.type === 'heading') return extractInlineText(block.content)
  if (block.type === 'codeBlock') return (block.content || []).map((node) => node.text).join('')
  if (block.type === 'horizontalRule') return ''
  if (block.type === 'listItem' || block.type === 'blockquote') return (block.content || []).map(extractBlockText).join('\n')
  return (block.content || []).map(extractBlockText).join('\n')
}

function extractFromRichContent(value: RichTextContent) {
  return value.content.map(extractBlockText).join('\n')
}

export function validateRichPostContent(value: unknown): RichTextValidationResult {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    return { valid: false, errors: ['richContent must be JSON serializable'] }
  }
  if (typeof serialized !== 'string') return { valid: false, errors: ['richContent must be JSON serializable'] }
  if (serialized.length > MAX_RICH_TEXT_JSON_LENGTH) return { valid: false, errors: ['richContent is too large'] }

  const state: ValidationState = { errors: [], nodeCount: 0 }
  if (!isRecord(value) || value.type !== 'doc') return { valid: false, errors: ['richContent root must be a doc'] }
  if (!hasOnlyKeys(value, ['type', 'content'])) fail(state, 'richContent root has unknown attributes')
  if (!Array.isArray(value.content)) fail(state, 'richContent.content must be an array')

  const content: RichTextBlockNode[] = []
  if (Array.isArray(value.content)) {
    for (let index = 0; index < value.content.length; index += 1) {
      const block = normalizeBlockNode(value.content[index], state, 1, 'richContent.content[' + index + ']')
      if (block) content.push(block)
    }
  }

  const normalized: RichTextContent = { type: 'doc', content }
  const plainText = extractFromRichContent(normalized)
  if (plainText.length > MAX_POST_PLAIN_TEXT_LENGTH) fail(state, 'post content is too long')
  return state.errors.length ? { valid: false, errors: state.errors } : { valid: true, value: normalized, plainText }
}

export function extractPlainText(value: unknown) {
  const result = validateRichPostContent(value)
  return result.valid ? result.plainText : ''
}

export function collectMusicReferenceSongIds(value: RichTextContent) {
  const ids: string[] = []
  const seen = new Set<string>()
  const visitInline = (node: RichTextInlineNode) => {
    if (node.type === 'musicReference' && !seen.has(node.attrs.songId)) {
      seen.add(node.attrs.songId)
      ids.push(node.attrs.songId)
    }
  }
  const visitBlock = (block: RichTextBlockNode): void => {
    if (block.type === 'paragraph' || block.type === 'heading') {
      block.content?.forEach(visitInline)
      return
    }
    if (block.type === 'listItem' || block.type === 'blockquote') {
      block.content?.forEach(visitBlock)
      return
    }
    if (block.type === 'bulletList' || block.type === 'orderedList') {
      block.content?.forEach(visitBlock)
    }
  }
  value.content.forEach(visitBlock)
  return ids
}

export type RichTextMusicReferenceMetadata = {
  title: string
  artist: string
  album: string
}

/**
 * Replace only the display snapshot of a validated music reference. The
 * songId remains the canonical identity and is validated against MusicSong by
 * the post API before this helper is used for persistence.
 */
export function enrichMusicReferenceMetadata(
  value: RichTextContent,
  metadataBySongId: ReadonlyMap<string, RichTextMusicReferenceMetadata>,
): RichTextContent {
  const mapInline = (node: RichTextInlineNode): RichTextInlineNode => {
    if (node.type !== 'musicReference') return node
    const metadata = metadataBySongId.get(node.attrs.songId)
    if (!metadata) return node
    return {
      type: 'musicReference',
      attrs: {
        songId: node.attrs.songId,
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
      },
    }
  }
  const mapBlock = (block: RichTextBlockNode): RichTextBlockNode => {
    if (block.type === 'paragraph' || block.type === 'heading') {
      return block.content ? { ...block, content: block.content.map(mapInline) } : block
    }
    if (block.type === 'listItem' || block.type === 'blockquote') {
      return block.content ? { ...block, content: block.content.map(mapBlock) } : block
    }
    if (block.type === 'bulletList' || block.type === 'orderedList') {
      return block.content ? { ...block, content: block.content.map((item) => mapBlock(item) as RichTextListItemNode) } : block
    }
    return block
  }
  return { type: 'doc', content: value.content.map(mapBlock) }
}

export function plainTextToRichContent(value: string): RichTextContent {
  const lines = value.replace(/\r\n?/gu, '\n').split('\n')
  return {
    type: 'doc',
    content: lines.map((line) => line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }),
  }
}

type MutableContainer =
  | { kind: 'root'; content: RichTextBlockNode[] }
  | { kind: 'blockquote'; node: RichTextBlockquoteNode }
  | { kind: 'list'; node: RichTextBulletListNode | RichTextOrderedListNode }
  | { kind: 'listItem'; node: RichTextListItemNode }

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (entity, name: string) => {
    const normalizedName = name.toLowerCase()
    const codePoint = normalizedName.startsWith('#x')
      ? Number.parseInt(normalizedName.slice(2), 16)
      : normalizedName.startsWith('#')
        ? Number.parseInt(normalizedName.slice(1), 10)
        : null
    if (codePoint !== null) return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity
    return namedEntities[normalizedName] || entity
  })
}

/**
 * Convert old HTML-ish Post.content values into the same safe JSON shape used
 * by new posts. It is deliberately a small allow-list parser: unknown and
 * dangerous elements are ignored, never rendered as HTML.
 */
export function legacyHtmlToRichContent(value: string): RichTextContent | null {
  if (!/<[a-z][^>]*>/iu.test(value)) return null

  const root: MutableContainer = { kind: 'root', content: [] }
  const containers: MutableContainer[] = [root]
  const marks: Array<{ tag: string; mark: RichTextMark }> = []
  const blockTags = new Set(['address', 'article', 'aside', 'div', 'dl', 'dt', 'dd', 'figcaption', 'figure', 'footer', 'header', 'main', 'nav', 'section'])
  const dangerousTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'form', 'input', 'textarea', 'button', 'video', 'audio', 'img', 'link', 'meta'])
  const tokens = /<!--[\s\S]*?-->|<\/?[a-z][^>]*>/giu
  let currentBlock: RichTextParagraphNode | RichTextHeadingNode | RichTextCodeBlockNode | null = null
  let skipDepth = 0
  let cursor = 0

  const closeBlock = () => {
    currentBlock = null
  }

  const currentBlockContainer = () => {
    for (let index = containers.length - 1; index >= 0; index -= 1) {
      const container = containers[index]
      if (container.kind === 'root') return container
      if (container.kind === 'blockquote' || container.kind === 'listItem') return container
    }
    return root
  }

  const appendBlock = (block: RichTextBlockNode) => {
    const container = currentBlockContainer()
    if (container.kind === 'root') container.content.push(block)
    else if (container.kind === 'blockquote' || container.kind === 'listItem') container.node.content = [...(container.node.content || []), block]
  }

  const ensureParagraph = () => {
    if (currentBlock) return currentBlock
    const paragraph: RichTextParagraphNode = { type: 'paragraph', content: [] }
    appendBlock(paragraph)
    currentBlock = paragraph
    return paragraph
  }

  const appendInlineText = (text: string) => {
    if (!text) return
    const block = currentBlock
    if (block?.type === 'codeBlock') {
      block.content = [...(block.content || []), { type: 'text', text }]
      return
    }
    const paragraph = ensureParagraph()
    const activeMarks = marks.map(({ mark }) => mark)
    const inline: RichTextInlineNode = activeMarks.length
      ? { type: 'text', text, marks: activeMarks }
      : { type: 'text', text }
    paragraph.content = [...(paragraph.content || []), inline]
  }

  const appendBreak = () => {
    const block = currentBlock
    if (block?.type === 'codeBlock') {
      appendInlineText('\n')
      return
    }
    const paragraph = ensureParagraph()
    paragraph.content = [...(paragraph.content || []), { type: 'hardBreak' }]
  }

  const parseAttributes = (source: string) => {
    const attributes: Record<string, string> = {}
    const pattern = /([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu
    for (const match of source.matchAll(pattern)) attributes[match[1].toLowerCase()] = decodeHtmlEntities(match[2] || match[3] || match[4] || '')
    return attributes
  }

  const pushMark = (tag: string, mark: RichTextMark | null) => {
    if (mark) marks.push({ tag, mark })
  }

  const popMark = (tag: string) => {
    for (let index = marks.length - 1; index >= 0; index -= 1) {
      if (marks[index].tag === tag) {
        marks.splice(index, 1)
        return
      }
    }
  }

  const closeContainer = (kind: MutableContainer['kind']) => {
    for (let index = containers.length - 1; index > 0; index -= 1) {
      if (containers[index].kind === kind) {
        containers.splice(index, 1)
        return
      }
    }
  }

  const handleTag = (rawTag: string) => {
    const closing = /^<\//u.test(rawTag)
    const nameMatch = rawTag.match(/^<\/?\s*([a-z][\w:-]*)/iu)
    if (!nameMatch) return
    const tag = nameMatch[1].toLowerCase()
    if (skipDepth > 0) {
      if (closing) skipDepth -= 1
      else if (!rawTag.endsWith('/>') && dangerousTags.has(tag)) skipDepth += 1
      return
    }
    if (!closing && dangerousTags.has(tag)) {
      skipDepth = rawTag.endsWith('/>') ? 0 : 1
      closeBlock()
      return
    }

    if (closing) {
      if (tag === 'p' || /^h[1-3]$/u.test(tag) || tag === 'pre' || tag === 'li') closeBlock()
      if (tag === 'ul' || tag === 'ol') closeContainer('list')
      if (tag === 'li') closeContainer('listItem')
      if (tag === 'blockquote') {
        closeBlock()
        closeContainer('blockquote')
      }
      if (['strong', 'b', 'em', 'i', 's', 'del', 'code', 'a', 'span'].includes(tag)) popMark(tag)
      return
    }

    const attributes = parseAttributes(rawTag)
    if (blockTags.has(tag)) {
      closeBlock()
      return
    }
    if (tag === 'p' || /^h[1-3]$/u.test(tag)) {
      closeBlock()
      const block: RichTextParagraphNode | RichTextHeadingNode = tag === 'p'
        ? { type: 'paragraph', content: [] }
        : { type: 'heading', attrs: { level: Number(tag.slice(1)) as 1 | 2 | 3 }, content: [] }
      appendBlock(block)
      currentBlock = block
      return
    }
    if (tag === 'pre') {
      closeBlock()
      const block: RichTextCodeBlockNode = { type: 'codeBlock', content: [] }
      appendBlock(block)
      currentBlock = block
      return
    }
    if (tag === 'blockquote') {
      closeBlock()
      const block: RichTextBlockquoteNode = { type: 'blockquote', content: [] }
      appendBlock(block)
      containers.push({ kind: 'blockquote', node: block })
      return
    }
    if (tag === 'ul' || tag === 'ol') {
      closeBlock()
      const node: RichTextBulletListNode | RichTextOrderedListNode = tag === 'ol'
        ? { type: 'orderedList', attrs: { start: Number.parseInt(attributes.start || '1', 10) || 1 }, content: [] }
        : { type: 'bulletList', content: [] }
      appendBlock(node)
      containers.push({ kind: 'list', node })
      return
    }
    if (tag === 'li') {
      closeBlock()
      const list = [...containers].reverse().find((container): container is Extract<MutableContainer, { kind: 'list' }> => container.kind === 'list')
      if (!list) {
        ensureParagraph()
        return
      }
      const item: RichTextListItemNode = { type: 'listItem', content: [] }
      list.node.content = [...(list.node.content || []), item]
      containers.push({ kind: 'listItem', node: item })
      return
    }
    if (tag === 'br') {
      appendBreak()
      return
    }
    if (tag === 'hr') {
      closeBlock()
      appendBlock({ type: 'horizontalRule' })
      return
    }
    if (tag === 'strong' || tag === 'b') pushMark(tag, { type: 'bold' })
    else if (tag === 'em' || tag === 'i') pushMark(tag, { type: 'italic' })
    else if (tag === 's' || tag === 'del') pushMark(tag, { type: 'strike' })
    else if (tag === 'code' && currentBlock?.type !== 'codeBlock') pushMark(tag, { type: 'code' })
    else if (tag === 'a') {
      const href = normalizeRichTextHref(attributes.href)
      pushMark(tag, href ? { type: 'link', attrs: { href } } : null)
    } else if (tag === 'span') {
      if (isRichTextColorToken(attributes['data-rich-color'])) pushMark(tag, { type: 'textColor', attrs: { token: attributes['data-rich-color'] } })
      if (isRichTextFontSizeToken(attributes['data-rich-size'])) pushMark(tag, { type: 'fontSize', attrs: { token: attributes['data-rich-size'] } })
    }
  }

  for (const match of value.matchAll(tokens)) {
    const token = match[0]
    const index = match.index || 0
    const text = value.slice(cursor, index)
    if (skipDepth === 0 && text) {
      const decoded = decodeHtmlEntities(text)
      if (currentBlock || decoded.trim()) appendInlineText(decoded)
    }
    handleTag(token)
    cursor = index + token.length
  }
  if (skipDepth === 0 && cursor < value.length) appendInlineText(decodeHtmlEntities(value.slice(cursor)))
  closeBlock()

  const result = validateRichPostContent({ type: 'doc', content: root.content })
  return result.valid ? result.value : { type: 'doc', content: [] }
}

export function richTextColorClass(token: RichTextColorToken) {
  return 'rich-text-color-' + token
}

export function richTextFontSizeClass(token: RichTextFontSizeToken) {
  return 'rich-text-size-' + token
}
