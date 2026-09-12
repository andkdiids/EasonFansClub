export const DIRECT_MESSAGE_RECALL_WINDOW_MS = 60_000
export const RECALLED_DIRECT_MESSAGE_TEXT = '消息已撤回'

export type DirectMessageRecallCandidate = Readonly<{
  senderId: string
  createdAt: Date
  isDeleted: boolean
  type?: string | null
  clientMessageId?: string | null
}>

export function getDirectMessageRecallCutoff(now = new Date()) {
  return new Date(now.getTime() - DIRECT_MESSAGE_RECALL_WINDOW_MS)
}

export function isWithinDirectMessageRecallWindow(createdAt: Date, now = new Date()) {
  const createdTime = createdAt.getTime()
  const nowTime = now.getTime()
  return Number.isFinite(createdTime)
    && Number.isFinite(nowTime)
    && createdTime <= nowTime
    && createdTime >= getDirectMessageRecallCutoff(now).getTime()
}

export function canRecallDirectMessage(
  message: DirectMessageRecallCandidate,
  userId: string,
  now = new Date(),
) {
  if (message.senderId !== userId) return { ok: false as const, code: 'NOT_SENDER' as const }
  if (message.type === 'SYSTEM' || message.clientMessageId?.startsWith('friend-request:')) {
    return { ok: false as const, code: 'NOT_RECALLABLE' as const }
  }
  if (message.isDeleted) return { ok: true as const, code: 'ALREADY_RECALLED' as const }
  if (!isWithinDirectMessageRecallWindow(message.createdAt, now)) return { ok: false as const, code: 'RECALL_WINDOW_EXPIRED' as const }
  return { ok: true as const, code: 'RECALLABLE' as const }
}
