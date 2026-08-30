import twemoji from 'twemoji'

/** Pinned asset source used by both the server renderer and the local canvas fallback. */
export const SHARE_CARD_EMOJI_VERSION = 'twemoji-14.0.2'
export const SHARE_CARD_EMOJI_ASSET_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/'

const EMOJI_MARKER_PREFIX = '__share-card-emoji:'
const EMOJI_TAG_PATTERN = /<img\b[^>]*\balt="([^"]*)"[^>]*\bsrc="(__share-card-emoji:[^"]+)"[^>]*\/\s*>/gu

export type ShareCardTextToken = Readonly<{
  type: 'text' | 'emoji'
  value: string
  codePoint?: string
  assetUrl?: string
}>

function appendTextToken(tokens: ShareCardTextToken[], value: string) {
  if (!value) return
  const previous = tokens[tokens.length - 1]
  if (previous?.type === 'text') {
    tokens[tokens.length - 1] = { ...previous, value: previous.value + value }
    return
  }
  tokens.push({ type: 'text', value })
}

/**
 * Split a line into ordinary text and complete Emoji grapheme candidates.
 * Twemoji owns the Unicode matching rules, so ZWJ, flags, skin tones, keycaps,
 * and variation selectors remain one token instead of being cut mid-sequence.
 */
export function tokenizeShareCardText(value: string): ShareCardTextToken[] {
  const parsed = twemoji.parse(value, {
    callback: (codePoint) => `${EMOJI_MARKER_PREFIX}${codePoint}`,
  })
  const tokens: ShareCardTextToken[] = []
  let cursor = 0
  for (const match of parsed.matchAll(EMOJI_TAG_PATTERN)) {
    const index = match.index ?? cursor
    appendTextToken(tokens, parsed.slice(cursor, index))
    const rawValue = match[1] || ''
    const marker = match[2] || ''
    const codePoint = marker.slice(EMOJI_MARKER_PREFIX.length)
    if (!codePoint) {
      appendTextToken(tokens, rawValue)
    } else {
      tokens.push({
        type: 'emoji',
        value: rawValue || twemoji.convert.fromCodePoint(codePoint),
        codePoint,
        assetUrl: shareCardEmojiAssetUrl(codePoint) || undefined,
      })
    }
    cursor = index + match[0].length
  }
  appendTextToken(tokens, parsed.slice(cursor))
  return tokens
}

export function shareCardEmojiAssetUrl(codePoint: string) {
  if (!/^[\da-f]+(?:-[\da-f]+)*$/iu.test(codePoint)) return null
  return `${SHARE_CARD_EMOJI_ASSET_BASE}${codePoint.toLowerCase()}.svg`
}

export function shareCardEmojiTokens(value: string) {
  return tokenizeShareCardText(value).filter((token): token is ShareCardTextToken & { type: 'emoji'; codePoint: string; assetUrl: string } => token.type === 'emoji' && Boolean(token.codePoint && token.assetUrl))
}
