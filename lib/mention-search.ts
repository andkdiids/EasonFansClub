export const MENTION_UID_LENGTH = 5
export const MENTION_SEARCH_RESULT_LIMIT = 15

export type MentionSearchQuery =
  | { mode: 'uid'; query: string; uid: number }
  | { mode: 'name'; query: string }
  | { mode: 'none'; query: string; reason: 'empty' | 'partial-uid' | 'invalid-uid' | 'too-short-name' }

/**
 * Keep UID lookup deliberately separate from name lookup. In particular, a
 * partial numeric query must never fall through to a nickname contains query.
 */
export function parseMentionSearchQuery(value: unknown): MentionSearchQuery {
  const query = String(value ?? '').trim().slice(0, 80)
  if (!query) return { mode: 'none', query, reason: 'empty' }

  if (/^\d+$/u.test(query)) {
    if (query.length !== MENTION_UID_LENGTH) return { mode: 'none', query, reason: 'partial-uid' }
    const uid = Number(query)
    if (!Number.isSafeInteger(uid) || uid < 0 || uid > 99_999) return { mode: 'none', query, reason: 'invalid-uid' }
    return { mode: 'uid', query, uid }
  }

  const characterCount = Array.from(query).length
  const minimumNameLength = /[\u3400-\u9fff]/u.test(query) ? 1 : 2
  if (characterCount < minimumNameLength) return { mode: 'none', query, reason: 'too-short-name' }
  return { mode: 'name', query }
}
