export const CHECK_IN_REPLY_PREVIEW_LIMIT = 3

export function getVisibleCheckInReplyCount(total: number, expanded: boolean) {
  const safeTotal = Math.max(0, Math.trunc(total) || 0)
  return expanded ? safeTotal : Math.min(safeTotal, CHECK_IN_REPLY_PREVIEW_LIMIT)
}

export function getCheckInReplyToggleLabel(total: number, expanded: boolean) {
  const safeTotal = Math.max(0, Math.trunc(total) || 0)
  if (safeTotal <= CHECK_IN_REPLY_PREVIEW_LIMIT) return null
  return expanded ? '收起回复' : `展开剩余 ${safeTotal - CHECK_IN_REPLY_PREVIEW_LIMIT} 条回复`
}
