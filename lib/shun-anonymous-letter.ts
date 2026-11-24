import { prisma } from '@/lib/prisma'

/**
 * Anonymous letters attach one short note to a single Shun round.
 *
 * Everything in this module is deliberately side-effect free with respect to
 * Shun economics: no amount, probability, attempt, capture or notification
 * budget is read or written here. Identity handling is also strict — the sender
 * is only persisted for authorisation/audit and is never exposed through any
 * recipient-facing projection.
 */

export const ANONYMOUS_LETTER_MAX_LENGTH = 60
export const ANONYMOUS_LETTER_INTRO = '一封来自神秘 EF 的信'
export const ANONYMOUS_LETTER_SIGNATURE = '—— 一位神秘的 EF'

export type AnonymousMessageField =
  | { provided: false, content?: undefined, error?: undefined }
  | { provided: true, content: string, error: string | null }

/**
 * Normalises the optional `anonymousMessage` request field.
 *
 * - `undefined` / `null` means "no letter": the caller runs the untouched path.
 * - Strings are trimmed, CRLF is folded to LF and invisible control characters
 *   are dropped, so a payload made only of whitespace is rejected instead of
 *   producing an envelope with an empty body.
 * - Length is counted in user-perceived characters (code points) so an emoji
 *   costs one character rather than two.
 */
export function readAnonymousMessageField(value: unknown): AnonymousMessageField {
  if (value === undefined || value === null) return { provided: false }
  if (typeof value !== 'string') return { provided: true, content: '', error: '留言格式无效，请重新输入。' }
  const content = value
    .replace(/\r\n?/g, '\n')
    // Keep line feeds and tabs; drop other C0/C1 control characters.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .trim()
  if (!content) return { provided: true, content: '', error: '留言内容不能为空。' }
  if ([...content].length > ANONYMOUS_LETTER_MAX_LENGTH) {
    return { provided: true, content, error: `留言最多 ${ANONYMOUS_LETTER_MAX_LENGTH} 个字符。` }
  }
  return { provided: true, content, error: null }
}

export function anonymousLetterLength(content: string) {
  return [...content].length
}

export type AnonymousLetterView = {
  id: string
  roundId: string
  content: string
  createdAt: string
  isRead: boolean
  /** The round already has a settled capture result. */
  captured: boolean
  /** The round can still be investigated right now. */
  capturable: boolean
  goldenUntil: string
  amount: number
}

/**
 * Loads one letter for its recipient.
 *
 * Returns `null` for every "not yours / not available" case so the route can
 * answer a uniform 404: an unknown id, a letter addressed to somebody else, a
 * hidden letter and a letter whose round no longer belongs to the caller are
 * indistinguishable to the client. `senderId` is never part of the projection.
 */
export async function readAnonymousLetter(userId: string, id: string): Promise<AnonymousLetterView | null> {
  if (!/^[a-z0-9]{1,40}$/.test(id)) return null
  const letter = await prisma.shunMasterAnonymousLetter.findFirst({
    where: { recipientId: userId, hiddenAt: null, OR: [{ id }, { roundId: id }] },
    select: { id: true, roundId: true, content: true, createdAt: true, readAt: true },
  })
  if (!letter) return null
  const round = await prisma.shunMasterRound.findFirst({
    where: { id: letter.roundId, victimId: userId },
    select: { id: true, victimId: true, result: true, candidates: true, goldenUntil: true, amount: true },
  })
  if (!round || round.victimId !== userId) return null
  if (!letter.readAt) {
    // Conditional update keeps a concurrent double-open from rewriting readAt.
    await prisma.shunMasterAnonymousLetter.updateMany({
      where: { id: letter.id, readAt: null }, data: { readAt: new Date() },
    })
  }
  return {
    id: letter.id,
    roundId: letter.roundId,
    content: letter.content,
    createdAt: letter.createdAt.toISOString(),
    isRead: true,
    captured: round.result !== null,
    capturable: round.result === null && (round.candidates as string[]).length === 3,
    goldenUntil: round.goldenUntil.toISOString(),
    amount: round.amount,
  }
}

/** Recipient-facing notification copy for a round that carries a letter. */
export const ANONYMOUS_LETTER_NOTIFICATION = {
  title: '你收到一封神秘来信 ✉️',
  content: '有位神秘的 EF，在顺走挂号费后给你留下了一封信。',
} as const

/**
 * The link builder lives in the dependency-free notification module so both the
 * server writer and the client notification surfaces share one definition.
 */
export { anonymousLetterNotificationLink } from './shun-letter-notification'
