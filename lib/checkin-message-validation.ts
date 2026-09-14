import { CHECK_IN_MESSAGE_MAX_LENGTH } from '@/lib/checkin-message-constants'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'
import { sanitizeText } from '@/lib/security'

export type CheckInMessageValidationResult =
  | { ok: true; message: string }
  | { ok: false; code: 'INVALID_MESSAGE' | typeof CONTENT_CONTAINS_BANNED_WORD; error?: typeof CONTENT_CONTAINS_BANNED_WORD; message: string }

/**
 * Keep the supplemental-message and one-time-edit inputs on the same
 * boundary: raw length/blank checks, text sanitization, and banned-word
 * validation all happen before the database transaction begins.
 */
export async function validateCheckInMessage(rawMessage: unknown): Promise<CheckInMessageValidationResult> {
  if (typeof rawMessage !== 'string' || rawMessage.length > CHECK_IN_MESSAGE_MAX_LENGTH || !rawMessage.trim()) {
    return { ok: false, code: 'INVALID_MESSAGE', message: '留言不能为空且最多 300 字' }
  }

  const message = sanitizeText(rawMessage, CHECK_IN_MESSAGE_MAX_LENGTH)
  if (!message) return { ok: false, code: 'INVALID_MESSAGE', message: '留言不能为空且最多 300 字' }

  if ((await checkBannedWords(message)).blocked) {
    return {
      ok: false,
      error: CONTENT_CONTAINS_BANNED_WORD,
      code: CONTENT_CONTAINS_BANNED_WORD,
      message: BANNED_WORD_MESSAGE,
    }
  }

  return { ok: true, message }
}
