/**
 * Client-safe recognition rules for Shun Master anonymous-letter notifications.
 *
 * The notification center treats every personal `SYSTEM` row as a generic
 * system notice, which previously swallowed the letter entry. Importing the
 * Prisma-backed letter service into a client component would pull database code
 * into the browser bundle, so the detection rules and the canonical link live
 * here instead — dependency free and safe to import from any surface.
 *
 * Detection is intentionally restricted to server-written identifiers:
 * - the notification key `shun:<roundId>:taken-letter`, written by the Shun
 *   notification helper next to the round itself;
 * - the structured link `/shun-master?record=<roundId>[&side=in]&letter=…`.
 * Titles and copy are never inspected, so an unrelated system notice can never
 * be hijacked into the letter flow, and a round id is never guessed.
 */

export const ANONYMOUS_LETTER_PATH = '/shun-master'
export const ANONYMOUS_LETTER_FLAG = '1'
export const ANONYMOUS_LETTER_KEY_PREFIX = 'shun:'
export const ANONYMOUS_LETTER_KEY_SUFFIX = ':taken-letter'

const ROUND_ID_PATTERN = /^[a-z0-9]{1,40}$/
const LETTER_KEY_PATTERN = /^shun:([a-z0-9]{1,40}):taken-letter$/

export type ShunLetterNotificationLike = {
  key?: string | null
  link?: string | null
  targetUrl?: string | null
}

/** Canonical letter link for one round. Must stay byte-identical to stored links. */
export function anonymousLetterNotificationLink(roundId: string) {
  return `${ANONYMOUS_LETTER_PATH}?record=${roundId}&side=in&letter=${ANONYMOUS_LETTER_FLAG}`
}

/** `shun:<roundId>:taken-letter` → roundId (otherwise null). */
export function shunLetterRoundIdFromKey(key: string | null | undefined): string | null {
  if (!key) return null
  return LETTER_KEY_PATTERN.exec(key.trim())?.[1] ?? null
}

/**
 * Structured letter link → roundId.
 * Requires the exact path, a valid `record` and a non-empty `letter` marker, so
 * an ordinary `/shun-master?record=…` notification stays on the old path.
 */
export function shunLetterRoundIdFromLink(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw.startsWith(ANONYMOUS_LETTER_PATH)) return null
  let url: URL
  try {
    url = new URL(raw, 'https://letter.invalid')
  } catch {
    return null
  }
  if (url.pathname !== ANONYMOUS_LETTER_PATH) return null
  const record = url.searchParams.get('record')?.trim() || ''
  const letter = url.searchParams.get('letter')?.trim() || ''
  if (!letter) return null
  if (!ROUND_ID_PATTERN.test(record)) return null
  return record
}

/** Round id carried by a notification, preferring the stored link over the key. */
export function shunLetterRoundId(item: ShunLetterNotificationLike): string | null {
  return shunLetterRoundIdFromLink(item.link)
    ?? shunLetterRoundIdFromLink(item.targetUrl)
    ?? shunLetterRoundIdFromKey(item.key)
}

/**
 * Canonical navigation target for a letter notification, or null when the
 * notification has nothing to do with a letter. Rebuilding the link from the
 * trusted round id recovers historical rows whose link is missing.
 */
export function shunLetterHref(item: ShunLetterNotificationLike): string | null {
  const linkRoundId = shunLetterRoundIdFromLink(item.link) ?? shunLetterRoundIdFromLink(item.targetUrl)
  if (linkRoundId) {
    const stored = (item.link || item.targetUrl || '').trim()
    // Only reuse a relative internal path; anything else is rebuilt so a stored
    // absolute/localhost legacy value can never become an off-site navigation.
    return stored.startsWith('/') ? stored : anonymousLetterNotificationLink(linkRoundId)
  }
  const keyRoundId = shunLetterRoundIdFromKey(item.key)
  return keyRoundId ? anonymousLetterNotificationLink(keyRoundId) : null
}

export function isShunLetterNotification(item: ShunLetterNotificationLike): boolean {
  return shunLetterHref(item) !== null
}

export const ANONYMOUS_LETTER_ENTRY_LABEL = '打开神秘来信'
export const SHUN_INVESTIGATE_ENTRY_LABEL = '前往调查'

/**
 * Canonical "go and investigate" link for one round.
 *
 * It always carries the round id *and* `side=in`, so the victim lands on
 * 「谁顺了我」 with the matching record focused. A bare `/shun-master` would drop
 * the victim on the default tab with no way to find the record.
 */
export function shunInvestigationLink(roundId: string) {
  return `${ANONYMOUS_LETTER_PATH}?record=${encodeURIComponent(roundId)}&side=in`
}

const ROUND_KEY_PATTERN = /^shun:([a-z0-9]{1,40}):(taken|taken-letter)$/
const INVESTIGATION_LINK_PATTERN = /^\/shun-master$/

export type ShunRoundNotificationKind = 'taken' | 'taken-letter'

/**
 * Recognises a Shun round notification from server-written identifiers only:
 * the key `shun:<roundId>:taken` / `shun:<roundId>:taken-letter`, or a
 * `/shun-master?record=<roundId>` link. Titles and copy are never inspected, so
 * an unrelated system notice can never be routed into the investigation flow.
 */
export function shunRoundNotification(item: ShunLetterNotificationLike):
  { roundId: string; kind: ShunRoundNotificationKind } | null {
  const key = (item.key || '').trim()
  const fromKey = ROUND_KEY_PATTERN.exec(key)
  if (fromKey) return { roundId: fromKey[1], kind: fromKey[2] as ShunRoundNotificationKind }
  const raw = (item.link || item.targetUrl || '').trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw, 'https://letter.invalid')
  } catch {
    return null
  }
  if (!INVESTIGATION_LINK_PATTERN.test(url.pathname)) return null
  const record = url.searchParams.get('record')?.trim() || ''
  if (!ROUND_ID_PATTERN.test(record)) return null
  return { roundId: record, kind: url.searchParams.get('letter') ? 'taken-letter' : 'taken' }
}

/** Round id of any Shun round notification (plain or letter), or null. */
export function shunRoundNotificationId(item: ShunLetterNotificationLike): string | null {
  return shunRoundNotification(item)?.roundId ?? null
}

/**
 * Investigation target for a Shun notification. Rebuilt from the trusted round
 * id so historical rows with a bare `/shun-master?record=…` link (no `side`)
 * still land on the right tab.
 */
export function shunInvestigationHref(item: ShunLetterNotificationLike): string | null {
  const parsed = shunRoundNotification(item)
  return parsed ? shunInvestigationLink(parsed.roundId) : null
}
