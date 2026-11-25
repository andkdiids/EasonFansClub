import { prisma } from '@/lib/prisma'
import { ANONYMOUS_LETTER_MAX_LENGTH, readAnonymousMessageField, type AnonymousMessageField } from './shun-anonymous-letter'
import { shunPerson, type ShunPerson } from './shun-person'

/**
 * Counter notes left by the capturer for the caught actor (V5).
 *
 * Unlike the anonymous take letter this one is signed: after a successful
 * capture the true actor is already exposed to the victim, so the caught player
 * is told who caught them. Only the shared public projection (`shunPerson`) is
 * ever returned — never a database id, email or phone.
 *
 * Nothing here touches Shun economics: no amount, probability, attempt, capture
 * or bonus value is read or written by this module.
 */

export const CAPTURE_LETTER_MAX_LENGTH = ANONYMOUS_LETTER_MAX_LENGTH
export const CAPTURE_LETTER_INTRO = '抓获你的这位 EF 留言了'
export const CAPTURE_LETTER_TITLE = '给被抓到的 EF 留句话'
export const CAPTURE_LETTER_PLACEHOLDER = '抓到你啦！有什么想对 TA 说的？'

/**
 * Reuses the exact same normalisation as the anonymous letter (trim, CRLF fold,
 * control-character strip, 60 code points), so both letters share one content
 * contract and one set of error messages.
 */
export function readCaptureMessageField(value: unknown): AnonymousMessageField {
  return readAnonymousMessageField(value)
}

export function captureLetterLength(content: string) {
  return [...content].length
}

/** Notification copy for a capture result. One title, two bodies. */
export const CAPTURE_RESULT_NOTIFICATION = {
  title: '你已被逮捕！🚨',
  plain: (amount: number) => `你顺走的 ${amount} 挂号费已被成功追回！`,
  letter: (amount: number) => `你顺走的 ${amount} 挂号费已被成功追回，对方还给你留下了一句话！`,
} as const

/** Notification keys and links. Distinct from the take-flow ones and never rewritten. */
export {
  CAPTURE_LETTER_ENTRY_LABEL, CAPTURE_RESULT_ENTRY_LABEL, captureInvestigationLink,
  captureLetterNotificationLink as captureLetterLink, captureNotifyKey,
} from './shun-letter-notification'

/** Recipient-facing view of one counter note. */
export type CaptureLetterView = {
  id: string
  roundId: string
  content: string
  createdAt: string
  isRead: boolean
  /** Public projection of the capturer — nickname, avatar and uid only. */
  person: ShunPerson | null
  /** Registration fee actually recovered by this capture (bonus excluded). */
  recovered: number
  /** Platform bonus granted on top, if the roll won. */
  bonus: number
}

/**
 * Loads one counter note for the caught actor.
 *
 * Returns `null` for every "not yours / not available" case so the route can
 * answer a uniform 404, exactly like the anonymous letter reader.
 */
export async function readCaptureLetter(userId: string, id: string): Promise<CaptureLetterView | null> {
  if (!/^[a-z0-9]{1,40}$/.test(id)) return null
  const letter = await prisma.shunMasterCaptureLetter.findFirst({
    where: { recipientId: userId, hiddenAt: null, OR: [{ id }, { roundId: id }] },
    select: { id: true, roundId: true, senderId: true, content: true, createdAt: true, readAt: true },
  })
  if (!letter) return null
  const round = await prisma.shunMasterRound.findFirst({
    where: { id: letter.roundId, actorId: userId },
    select: { id: true, result: true, recovered: true, bonusAwarded: true },
  })
  if (!round || round.result !== 'SUCCESS') return null
  if (!letter.readAt) {
    await prisma.shunMasterCaptureLetter.updateMany({
      where: { id: letter.id, readAt: null }, data: { readAt: new Date() },
    })
  }
  return {
    id: letter.id,
    roundId: letter.roundId,
    content: letter.content,
    createdAt: letter.createdAt.toISOString(),
    isRead: true,
    person: await shunPerson(prisma, letter.senderId),
    recovered: round.recovered,
    bonus: round.bonusAwarded,
  }
}
