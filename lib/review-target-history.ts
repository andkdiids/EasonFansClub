type HistoryRow = {
  id: string
  action: string
  actorName: string | null
  createdAt: Date
  rejectionReason: string | null
}

export async function withReviewTargetHistory<T extends { sourceType: string; sourceId: string }>(
  target: T | null,
  load: (ids: readonly string[], context: string) => Promise<Map<string, HistoryRow[]>>,
) {
  if (!target || target.sourceType !== 'POST') return target
  try {
    const rows = await load([target.sourceId], 'admin.review.detail')
    const history = (rows.get(target.sourceId) ?? []).map(({ id, action, actorName, createdAt, rejectionReason }) => ({
      id, action, actorName, createdAt: createdAt.toISOString(), rejectionReason,
    }))
    return { ...target, history }
  } catch {
    return { ...target, history: [] }
  }
}
