/** A seed is a proposal, never an approval or a replacement for approved work. */
export type SeedDecision = 'CREATE_PENDING' | 'SKIPPED_ALREADY_APPROVED' | 'UPDATE_AVAILABLE'
  | 'SKIPPED_EXISTING' | 'CANDIDATE_UPDATE_AVAILABLE' | 'AUDIO_ASSET_REVIEW_REQUIRED'

export type SeedDiff = { field: string; old: string; next: string; truncated: boolean }

export type SeedPlanItem<T> = {
  candidate: T
  existing: ({ externalId?: string; lessonId?: string | null; status: string; updatedAt?: Date; assetStatus?: string | null; cosKey?: string | null } & Record<string, unknown>) | null
  decision: SeedDecision
  diff: SeedDiff[]
}

function printable(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return '[unavailable]' }
}

function equalValue(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined) return right === null || right === undefined
  if (right === null || right === undefined) return false
  if (typeof left !== 'object' || typeof right !== 'object') return left === right
  // Prisma JSON fields are plain arrays/objects. Property order is not semantic.
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
      : value
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right))
}

function changedFields(candidate: Record<string, unknown>, existing: Record<string, unknown>, type: 'teaching' | 'question' | 'audio' | 'definition'): SeedDiff[] {
  return Object.entries(candidate)
    .filter(([field, value]) => field !== 'externalId' && field !== 'status' && !(type === 'definition' && field === 'lessonId')
      && !(type === 'audio' && (field === 'assetStatus' || field === 'audioVersion'))
      && value !== undefined && !equalValue(value, existing[field]))
    .map(([field, value]) => {
      const old = printable(existing[field])
      const next = printable(value)
      return { field, old: old.slice(0, 600), next: next.slice(0, 600), truncated: old.length > 600 || next.length > 600 }
    })
}

export function planSeedRows<T extends { externalId?: string; lessonId?: string | null }>(
  candidates: T[],
  existingRows: Array<{ externalId?: string; lessonId?: string | null; status: string; updatedAt?: Date; assetStatus?: string | null; cosKey?: string | null } & Record<string, unknown>>,
  type: 'teaching' | 'question' | 'audio' | 'definition',
  key: 'externalId' | 'lessonId' = 'externalId',
): SeedPlanItem<T>[] {
  const byId = new Map(existingRows.map((row) => [row[key], row]))
  return candidates.map((candidate) => {
    const existing = byId.get(candidate[key]) || null
    if (!existing) return { candidate, existing, decision: 'CREATE_PENDING' as const, diff: [] }
    const diff = changedFields(candidate as Record<string, unknown>, existing as Record<string, unknown>, type)
    if (existing.status === 'APPROVED') return {
      candidate, existing, diff,
      decision: diff.length ? 'UPDATE_AVAILABLE' as const : 'SKIPPED_ALREADY_APPROVED' as const,
    }
    if (!diff.length) return { candidate, existing, diff, decision: 'SKIPPED_EXISTING' as const }
    // Never silently detach generated COS audio from the text/settings it was generated for.
    if (type === 'audio' && (existing.assetStatus !== 'NOT_GENERATED' || Boolean(existing.cosKey))) {
      return { candidate, existing, diff, decision: 'AUDIO_ASSET_REVIEW_REQUIRED' as const }
    }
    return { candidate, existing, diff, decision: 'CANDIDATE_UPDATE_AVAILABLE' as const }
  })
}

export function summarizeSeedPlan<T extends { externalId?: string; lessonId?: string | null }>(plan: SeedPlanItem<T>[]) {
  const count = (decision: SeedDecision) => plan.filter((item) => item.decision === decision).length
  const willImport = count('CREATE_PENDING')
  return {
    total: plan.length,
    willImport,
    existing: plan.length - willImport,
    skippedAlreadyApproved: count('SKIPPED_ALREADY_APPROVED'),
    updateAvailable: count('UPDATE_AVAILABLE'),
    candidateUpdatesAvailable: count('CANDIDATE_UPDATE_AVAILABLE'),
    audioAssetReviewRequired: count('AUDIO_ASSET_REVIEW_REQUIRED'),
    items: plan.filter((item) => item.decision !== 'CREATE_PENDING').map((item) => ({
      externalId: item.candidate.externalId || item.candidate.lessonId, decision: item.decision, diff: item.diff,
      expectedUpdatedAt: item.existing?.updatedAt instanceof Date ? item.existing.updatedAt.toISOString() : null,
    })),
  }
}
