import { sanitizeShareCardText, shareCardTypeLabel, SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH, type ShareCardData } from '@/lib/share-card'

export const SHARE_CARD_HERO_HEIGHT = 660
export const SHARE_CARD_PANEL_X = 56
export const SHARE_CARD_PANEL_TOP = 570
export const SHARE_CARD_PANEL_WIDTH = 968
export const SHARE_CARD_PANEL_PADDING_X = 48
export const SHARE_CARD_TEXT_WIDTH = SHARE_CARD_PANEL_WIDTH - SHARE_CARD_PANEL_PADDING_X * 2
export const SHARE_CARD_QR_SIZE = 224
export const SHARE_CARD_QR_FRAME_X = 788
export const SHARE_CARD_QR_FRAME_SIZE = 232
export const SHARE_CARD_QR_X = 792
export const SHARE_CARD_AVATAR_SIZE = 86
export const SHARE_CARD_AVATAR_X = 60
export const SHARE_CARD_AUTHOR_X = 172
export const SHARE_CARD_AUTHOR_WIDTH = 560
export const SHARE_CARD_FOOTER_LOGO_SIZE = 84
export const SHARE_CARD_FOOTER_LOGO_X = SHARE_CARD_AVATAR_X
export const SHARE_CARD_FOOTER_TEXT_X = SHARE_CARD_FOOTER_LOGO_X + SHARE_CARD_FOOTER_LOGO_SIZE + 12
/** Keep footer copy to the left of the 232px QR frame. */
export const SHARE_CARD_FOOTER_TEXT_WIDTH = SHARE_CARD_QR_FRAME_X - SHARE_CARD_FOOTER_TEXT_X - 28
export const SHARE_CARD_FOOTER_TITLE_FONT_SIZE = 26
export const SHARE_CARD_FOOTER_TITLE_LINE_HEIGHT = 34
export const SHARE_CARD_FOOTER_BRAND_FONT_SIZE = 20
export const SHARE_CARD_FOOTER_BRAND_LINE_HEIGHT = 28
export const SHARE_CARD_FOOTER_TEXT_GAP = 10
export const SHARE_CARD_FOOTER_TEXT_BLOCK_HEIGHT = SHARE_CARD_FOOTER_TITLE_LINE_HEIGHT + SHARE_CARD_FOOTER_TEXT_GAP + SHARE_CARD_FOOTER_BRAND_LINE_HEIGHT
export const SHARE_CARD_FOOTER_BRAND_BLOCK_HEIGHT = Math.max(SHARE_CARD_FOOTER_LOGO_SIZE, SHARE_CARD_FOOTER_TEXT_BLOCK_HEIGHT)
export const SHARE_CARD_FOOTER_TOP_GAP = 48
export const SHARE_CARD_FOOTER_BOTTOM_PADDING = 64
export const SHARE_CARD_CATEGORY_FONT_SIZE = 22
export const SHARE_CARD_CATEGORY_LINE_HEIGHT = 32
export const SHARE_CARD_TITLE_FONT_SIZE = 56
export const SHARE_CARD_TITLE_LINE_HEIGHT = 72
export const SHARE_CARD_DESCRIPTION_FONT_SIZE = 30
export const SHARE_CARD_DESCRIPTION_LINE_HEIGHT = 42
export const SHARE_CARD_META_FONT_SIZE = 25
export const SHARE_CARD_META_LINE_HEIGHT = 38
export const SHARE_CARD_AUTHOR_FONT_SIZE = 30
export const SHARE_CARD_AUTHOR_LINE_HEIGHT = 36
export const SHARE_CARD_DATE_FONT_SIZE = 22
export const SHARE_CARD_DATE_LINE_HEIGHT = 30

/** Post and activity media fill the Hero; the home poster keeps its contained logo treatment. */
export function shareCardHeroFit(type: ShareCardData['type']): 'cover' | 'contain' {
  return type === 'home' ? 'contain' : 'cover'
}

export type ShareCardTextBlock = Readonly<{
  lines: readonly string[]
  lineHeight: number
  height: number
}>

export type ShareCardLayout = Readonly<{
  width: typeof SHARE_CARD_WIDTH
  height: number
  panelTop: number
  panelHeight: number
  panelBottom: number
  categoryTop: number
  titleTop: number
  descriptionTop: number
  metaTop: number
  authorTop: number
  authorTextTop: number
  dateTop: number
  qrTop: number
  brandBlockTop: number
  brandBlockHeight: number
  brandLogoTop: number
  brandTextTop: number
  footerBottom: number
  title: string
  description: string
  author: string
  date: string
  meta: readonly string[]
  titleLines: readonly string[]
  descriptionLines: readonly string[]
  metaLines: readonly string[]
  authorLines: readonly string[]
  dateLines: readonly string[]
  authorBlockHeight: number
}>

function normalizeCardText(value: string | null | undefined) {
  return sanitizeShareCardText(value, { preserveLineBreaks: true })
}

function estimatedCharacterWidth(character: string, fontSize: number) {
  const codePoint = character.codePointAt(0) || 0
  if (/\s/u.test(character)) return fontSize * 0.35
  if (codePoint > 0xffff || (codePoint >= 0x1f000 && codePoint <= 0x1ffff)) return fontSize
  return codePoint <= 0x007f ? fontSize * 0.55 : fontSize
}

/** Wrap text by the same safe width model used by both the Sharp and Canvas renderers. */
export function wrapShareCardText(value: string, maxWidth: number, fontSize: number) {
  const lines: string[] = []
  for (const paragraph of value.replace(/\r\n?/g, '\n').split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let line = ''
    let lineWidth = 0
    for (const character of Array.from(paragraph)) {
      const characterWidth = estimatedCharacterWidth(character, fontSize)
      if (line && lineWidth + characterWidth > maxWidth) {
        lines.push(line)
        line = ''
        lineWidth = 0
      }
      line += character
      lineWidth += characterWidth
    }
    if (line) lines.push(line)
  }
  return lines
}

export function measureWrappedText(value: string, maxWidth: number, fontSize: number, lineHeight: number): ShareCardTextBlock {
  const lines = wrapShareCardText(value, maxWidth, fontSize)
  return { lines, lineHeight, height: lines.length * lineHeight }
}

function visibleMeta(data: ShareCardData) {
  return data.meta
    .map(({ label, value }) => ({ label: normalizeCardText(label), value: normalizeCardText(value) }))
    .filter(({ label, value }) => label && value)
    .slice(0, 3)
    .map(({ label, value }) => `${label}：${value}`)
}

/** Single flow layout shared by the API response, server renderer, and local fallback. */
export function calculateShareCardLayout(data: ShareCardData): ShareCardLayout {
  const title = normalizeCardText(data.title) || shareCardTypeLabel(data.type)
  const description = normalizeCardText(data.description) || '扫码查看完整内容'
  const author = normalizeCardText(data.author) || '私家E院'
  const date = normalizeCardText(data.date)
  const meta = visibleMeta(data)
  const titleBlock = measureWrappedText(title, SHARE_CARD_TEXT_WIDTH, SHARE_CARD_TITLE_FONT_SIZE, SHARE_CARD_TITLE_LINE_HEIGHT)
  const descriptionBlock = measureWrappedText(description, SHARE_CARD_TEXT_WIDTH, SHARE_CARD_DESCRIPTION_FONT_SIZE, SHARE_CARD_DESCRIPTION_LINE_HEIGHT)
  const metaBlocks = meta.map((value) => measureWrappedText(value, SHARE_CARD_TEXT_WIDTH, SHARE_CARD_META_FONT_SIZE, SHARE_CARD_META_LINE_HEIGHT))
  const metaLines = metaBlocks.flatMap((block) => block.lines)
  const authorBlock = measureWrappedText(author, SHARE_CARD_AUTHOR_WIDTH, SHARE_CARD_AUTHOR_FONT_SIZE, SHARE_CARD_AUTHOR_LINE_HEIGHT)
  const dateBlock = measureWrappedText(date ? `发布于 ${date}` : '来自私家E院', SHARE_CARD_AUTHOR_WIDTH, SHARE_CARD_DATE_FONT_SIZE, SHARE_CARD_DATE_LINE_HEIGHT)

  const categoryTop = SHARE_CARD_PANEL_TOP + 62
  const titleTop = categoryTop + SHARE_CARD_CATEGORY_LINE_HEIGHT + 24
  const descriptionTop = titleTop + titleBlock.height + 24
  const metaTop = descriptionTop + descriptionBlock.height + (metaLines.length ? 26 : 0)
  const metaHeight = metaLines.length * SHARE_CARD_META_LINE_HEIGHT
  const panelBottom = metaTop + metaHeight + 42
  const panelHeight = panelBottom - SHARE_CARD_PANEL_TOP
  const authorTop = panelBottom + 36
  const authorTextTop = authorTop + 18
  const dateTop = authorTextTop + authorBlock.height + 4
  const authorBlockHeight = Math.max(
    SHARE_CARD_AVATAR_SIZE,
    (authorTextTop - authorTop) + authorBlock.height + 4 + dateBlock.height + 10,
  )
  // The author row and the footer row are separate. QR belongs to the footer,
  // so a short card does not leave the brand copy stranded below an author-row
  // QR block. All footer items share one row center.
  const brandBlockTop = authorTop + authorBlockHeight + SHARE_CARD_FOOTER_TOP_GAP
  const brandBlockHeight = SHARE_CARD_FOOTER_BRAND_BLOCK_HEIGHT
  const qrTop = brandBlockTop
  const brandLogoTop = brandBlockTop + (brandBlockHeight - SHARE_CARD_FOOTER_LOGO_SIZE) / 2
  const brandTextTop = brandBlockTop + (brandBlockHeight - SHARE_CARD_FOOTER_TEXT_BLOCK_HEIGHT) / 2
  const footerBottom = Math.max(brandBlockTop + brandBlockHeight, qrTop + SHARE_CARD_QR_FRAME_SIZE) + SHARE_CARD_FOOTER_BOTTOM_PADDING
  const height = Math.max(SHARE_CARD_HEIGHT, footerBottom)

  return {
    width: SHARE_CARD_WIDTH,
    height,
    panelTop: SHARE_CARD_PANEL_TOP,
    panelHeight,
    panelBottom,
    categoryTop,
    titleTop,
    descriptionTop,
    metaTop,
    authorTop,
    authorTextTop,
    dateTop,
    qrTop,
    brandBlockTop,
    brandBlockHeight,
    brandLogoTop,
    brandTextTop,
    footerBottom,
    title,
    description,
    author,
    date,
    meta,
    titleLines: titleBlock.lines,
    descriptionLines: descriptionBlock.lines,
    metaLines,
    authorLines: authorBlock.lines,
    dateLines: dateBlock.lines,
    authorBlockHeight,
  }
}
