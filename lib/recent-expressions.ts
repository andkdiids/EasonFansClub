export const RECENT_EXPRESSIONS_STORAGE_KEY = 'recentExpressions'
export const LEGACY_RECENT_STICKERS_STORAGE_KEY = 'recentStickers'
export const LEGACY_RECENT_EMOJIS_STORAGE_KEY = 'recentEmojis'
export const LEGACY_RECENT_EMOJI_ITEMS_STORAGE_KEY = 'recentEmojiItems'

// The picker API and UI both previously exposed at most eight recent stickers.
// Keep that effective limit for the unified list and bound persisted data too.
export const MAX_RECENT_EXPRESSIONS = 8

export type RecentExpressionStickerType = 'STATIC' | 'GIF'

export type RecentExpression =
  | {
      type: 'emoji'
      value: string
    }
  | {
      type: 'sticker'
      id: string
      url: string
      name?: string | null
      stickerType?: RecentExpressionStickerType
      packId?: string
    }

export type RecentExpressionSticker = {
  id: string
  name: string | null
  url: string
  type: RecentExpressionStickerType
  packId?: string
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
type RecentSource = 'mixed' | 'stickers' | 'emojis'

function getLocalStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function normalizeRecentValue(value: unknown, source: RecentSource): RecentExpression | null {
  const rawString = stringValue(value)
  if (rawString) {
    return source === 'stickers'
      ? { type: 'sticker', id: rawString, url: '' }
      : { type: 'emoji', value: rawString }
  }

  const raw = objectValue(value)
  if (!raw) return null

  if (raw.type === 'emoji') {
    const emoji = stringValue(raw.value) || stringValue(raw.emoji)
    return emoji ? { type: 'emoji', value: emoji } : null
  }

  const looksLikePickerSticker = typeof raw.id === 'string' && (
    typeof raw.url === 'string' || raw.type === 'STATIC' || raw.type === 'GIF' || raw.stickerType === 'STATIC' || raw.stickerType === 'GIF'
  )
  const stickerId = stringValue(raw.stickerId) || (
    raw.type === 'sticker' ? stringValue(raw.id) : null
  ) || (
    source === 'stickers' ? stringValue(raw.id) : null
  ) || (
    looksLikePickerSticker ? stringValue(raw.id) : null
  )
  if (stickerId) {
    const rawStickerType = raw.stickerType || (raw.type === 'STATIC' || raw.type === 'GIF' ? raw.type : null)
    return {
      type: 'sticker',
      id: stickerId,
      url: stringValue(raw.url) || stringValue(raw.imageUrl) || '',
      name: typeof raw.name === 'string' ? raw.name : null,
      ...(rawStickerType === 'STATIC' || rawStickerType === 'GIF' ? { stickerType: rawStickerType } : {}),
      ...(typeof raw.packId === 'string' && raw.packId ? { packId: raw.packId } : {}),
    }
  }

  // A legacy emoji entry may have been stored as { value: '😂' } or
  // { emoji: '😂' } without a discriminant.
  const emoji = stringValue(raw.value) || stringValue(raw.emoji)
  return emoji ? { type: 'emoji', value: emoji } : null
}

function parseRecentList(value: unknown, source: RecentSource): RecentExpression[] {
  const raw = objectValue(value)
  const list = Array.isArray(value)
    ? value
    : raw && Array.isArray(raw.items)
      ? raw.items
      : raw
        ? [raw]
        : []
  return list
    .map((item) => normalizeRecentValue(item, source))
    .filter((item): item is RecentExpression => Boolean(item))
}

export function recentExpressionKey(expression: RecentExpression): string {
  return expression.type === 'emoji'
    ? `emoji:${expression.value}`
    : `sticker:${expression.id}`
}

export function dedupeRecentExpressions(
  expressions: readonly RecentExpression[],
  limit = MAX_RECENT_EXPRESSIONS,
): RecentExpression[] {
  const seen = new Set<string>()
  const result: RecentExpression[] = []
  for (const expression of expressions) {
    if (!expression) continue
    const key = recentExpressionKey(expression)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(expression)
    if (result.length >= limit) break
  }
  return result
}

export function addRecentExpression(
  expressions: readonly RecentExpression[],
  expression: RecentExpression,
  limit = MAX_RECENT_EXPRESSIONS,
): RecentExpression[] {
  return dedupeRecentExpressions([expression, ...expressions], limit)
}

export function mergeRecentExpressions(
  primary: readonly RecentExpression[],
  fallback: readonly RecentExpression[],
  limit = MAX_RECENT_EXPRESSIONS,
): RecentExpression[] {
  return dedupeRecentExpressions([...primary, ...fallback], limit)
}

/**
 * Read the one canonical recent-expression list and migrate older shapes.
 * Legacy keys are read only; all future writes go to recentExpressions.
 */
export function readRecentExpressions(storage: StorageLike | null = getLocalStorage()): RecentExpression[] {
  if (!storage) return []

  const sources: Array<{ key: string; source: RecentSource }> = [
    { key: RECENT_EXPRESSIONS_STORAGE_KEY, source: 'mixed' },
    { key: LEGACY_RECENT_STICKERS_STORAGE_KEY, source: 'stickers' },
    { key: LEGACY_RECENT_EMOJIS_STORAGE_KEY, source: 'emojis' },
    { key: LEGACY_RECENT_EMOJI_ITEMS_STORAGE_KEY, source: 'emojis' },
  ]
  let result: RecentExpression[] = []
  for (const { key, source } of sources) {
    try {
      const raw = storage.getItem(key)
      if (!raw) continue
      result = mergeRecentExpressions(result, parseRecentList(JSON.parse(raw), source))
    } catch {
      // Malformed or unavailable storage should not prevent the picker from opening.
    }
  }
  return result
}

export function writeRecentExpressions(
  expressions: readonly RecentExpression[],
  storage: StorageLike | null = getLocalStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(RECENT_EXPRESSIONS_STORAGE_KEY, JSON.stringify(dedupeRecentExpressions(expressions)))
  } catch {
    // Storage quota/privacy failures do not affect the in-memory picker state.
  }
}

export function createRecentEmoji(value: string): RecentExpression {
  return { type: 'emoji', value }
}

export function createRecentSticker(sticker: RecentExpressionSticker): RecentExpression {
  return {
    type: 'sticker',
    id: sticker.id,
    url: sticker.url,
    name: sticker.name,
    stickerType: sticker.type,
    ...(sticker.packId ? { packId: sticker.packId } : {}),
  }
}

export function hydrateRecentExpressions(
  expressions: readonly RecentExpression[],
  stickers: readonly RecentExpressionSticker[],
): RecentExpression[] {
  const stickersById = new Map(stickers.map((sticker) => [sticker.id, sticker]))
  return dedupeRecentExpressions(expressions.map((expression) => {
    if (expression.type === 'emoji') return expression
    const sticker = stickersById.get(expression.id)
    if (!sticker) return expression
    return {
      ...expression,
      url: expression.url || sticker.url,
      name: expression.name ?? sticker.name,
      stickerType: expression.stickerType || sticker.type,
      ...((expression.packId || sticker.packId) ? { packId: expression.packId || sticker.packId } : {}),
    }
  }))
}
