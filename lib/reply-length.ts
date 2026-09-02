import { countGraphemes } from '@/lib/checkin-mood'
import { sanitizeTextPreservingLength } from '@/lib/text'

export const REPLY_MAX_LENGTH = 300

export type ReplyLengthMetrics = {
  content: string
  actualLength: number
  maxLength: number
  exceededBy: number
}

/** Count user-perceived characters, keeping emoji and joined emoji sequences intact. */
export function countReplyCharacters(value: string) {
  return countGraphemes(value)
}

export function getReplyLengthMetrics(value: unknown, maxLength = REPLY_MAX_LENGTH): ReplyLengthMetrics {
  const content = sanitizeTextPreservingLength(value)
  const actualLength = countReplyCharacters(content)
  return {
    content,
    actualLength,
    maxLength,
    exceededBy: Math.max(0, actualLength - maxLength),
  }
}

export function replyTooLongPayload(metrics: ReplyLengthMetrics, label = '回复') {
  return {
    code: 'REPLY_TOO_LONG' as const,
    message: `${label}最多 ${metrics.maxLength} 字，当前超过 ${metrics.exceededBy} 字。`,
    maxLength: metrics.maxLength,
    actualLength: metrics.actualLength,
    exceededBy: metrics.exceededBy,
  }
}

export function replyTooLongMessage(metrics: ReplyLengthMetrics, label = '回复') {
  return replyTooLongPayload(metrics, label).message
}
