export const STICKER_PACK_EDIT_ROUTE = (packId: string) => `/profile/stickers/${packId}/edit`

/** The current schema uses REJECTED as the editable review-return state. */
export const USER_EDITABLE_STICKER_PACK_STATUSES = ['REJECTED'] as const

export function isUserEditableStickerPackStatus(status: string): boolean {
  return (USER_EDITABLE_STICKER_PACK_STATUSES as readonly string[]).includes(status)
}

export function getStickerPackReviewNotificationLink(packId: string, status: string) {
  return status === 'REJECTED' ? STICKER_PACK_EDIT_ROUTE(packId) : `/stickers/${packId}`
}

export function getStickerPackEditStateMessage(status: string): string | null {
  if (status === 'PENDING') return '该表情包已重新提交，正在等待审核。'
  if (status === 'APPROVED') return '该表情包已经审核通过。'
  return null
}
