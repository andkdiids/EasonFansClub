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
export const MAX_RICH_TEXT_MARKS_PER_TEXT = 3

export type RichTextMark =
  | { type: 'bold' }
  | { type: 'textColor'; attrs: { token: RichTextColorToken } }
  | { type: 'fontSize'; attrs: { token: RichTextFontSizeToken } }

export type RichTextInlineNode =
  | { type: 'text'; text: string; marks?: RichTextMark[] }
  | { type: 'hardBreak' }

export type RichTextParagraphNode = {
  type: 'paragraph'
  content?: RichTextInlineNode[]
}

export type RichTextContent = {
  type: 'doc'
  content: RichTextParagraphNode[]
}

export function isRichTextColorToken(value: unknown): value is RichTextColorToken {
  return typeof value === 'string' && (RICH_TEXT_COLOR_TOKENS as readonly string[]).includes(value)
}

export function isRichTextFontSizeToken(value: unknown): value is RichTextFontSizeToken {
  return typeof value === 'string' && (RICH_TEXT_FONT_SIZE_TOKENS as readonly string[]).includes(value)
}

type ValidationState = {
  errors: string[]
  nodeCount: number
}

type RichTextValidationResult =
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

    if (mark.type === 'bold') {
      if (!hasOnlyKeys(mark, ['type'])) fail(state, path + '.marks[' + index + '] has unknown attributes')
      marks.push({ type: 'bold' })
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
  state.nodeCount += 1
  if (state.nodeCount > MAX_RICH_TEXT_NODES) {
    fail(state, 'rich content contains too many nodes')
    return null
  }

  if (value.type === 'hardBreak') {
    if (!hasOnlyKeys(value, ['type'])) fail(state, path + ' has unknown attributes')
    return { type: 'hardBreak' }
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

function normalizeParagraph(value: unknown, state: ValidationState, depth: number, path: string): RichTextParagraphNode | null {
  if (!isRecord(value) || value.type !== 'paragraph') {
    fail(state, path + ' must be a paragraph')
    return null
  }
  if (depth > MAX_RICH_TEXT_DEPTH) {
    fail(state, path + ' is too deeply nested')
    return null
  }
  state.nodeCount += 1
  if (state.nodeCount > MAX_RICH_TEXT_NODES) {
    fail(state, 'rich content contains too many nodes')
    return null
  }
  if (!hasOnlyKeys(value, ['type', 'content'])) fail(state, path + ' has unknown attributes')
  if (value.content === undefined) return { type: 'paragraph' }
  if (!Array.isArray(value.content)) {
    fail(state, path + '.content must be an array')
    return null
  }

  const content: RichTextInlineNode[] = []
  for (let index = 0; index < value.content.length; index += 1) {
    const child = normalizeInlineNode(value.content[index], state, depth + 1, path + '.content[' + index + ']')
    if (child) content.push(child)
  }
  return state.errors.length ? null : content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

function extractFromParagraph(paragraph: RichTextParagraphNode) {
  return (paragraph.content || []).map((node) => node.type === 'hardBreak' ? '\n' : node.text).join('')
}

function extractFromRichContent(value: RichTextContent) {
  return value.content.map(extractFromParagraph).join('\n')
}

export function validateRichPostContent(value: unknown): RichTextValidationResult {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    return { valid: false, errors: ['richContent must be JSON serializable'] }
  }
  if (typeof serialized !== 'string') {
    return { valid: false, errors: ['richContent must be JSON serializable'] }
  }
  if (serialized.length > MAX_RICH_TEXT_JSON_LENGTH) {
    return { valid: false, errors: ['richContent is too large'] }
  }

  const state: ValidationState = { errors: [], nodeCount: 0 }
  if (!isRecord(value) || value.type !== 'doc') {
    return { valid: false, errors: ['richContent root must be a doc'] }
  }
  if (!hasOnlyKeys(value, ['type', 'content'])) fail(state, 'richContent root has unknown attributes')
  if (!Array.isArray(value.content)) fail(state, 'richContent.content must be an array')

  const paragraphs: RichTextParagraphNode[] = []
  if (Array.isArray(value.content)) {
    for (let index = 0; index < value.content.length; index += 1) {
      const paragraph = normalizeParagraph(value.content[index], state, 1, 'richContent.content[' + index + ']')
      if (paragraph) paragraphs.push(paragraph)
    }
  }

  const normalized: RichTextContent = { type: 'doc', content: paragraphs }
  const plainText = extractFromRichContent(normalized)
  if (plainText.length > MAX_POST_PLAIN_TEXT_LENGTH) fail(state, 'post content is too long')
  return state.errors.length ? { valid: false, errors: state.errors } : { valid: true, value: normalized, plainText }
}

export function extractPlainText(value: unknown) {
  const result = validateRichPostContent(value)
  return result.valid ? result.plainText : ''
}

export function plainTextToRichContent(value: string): RichTextContent {
  const lines = value.replace(/\r\n?/gu, '\n').split('\n')
  return {
    type: 'doc',
    content: lines.map((line) => line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }),
  }
}

export function richTextColorClass(token: RichTextColorToken) {
  return 'rich-text-color-' + token
}

export function richTextFontSizeClass(token: RichTextFontSizeToken) {
  return 'rich-text-size-' + token
}
