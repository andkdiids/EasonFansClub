export type PharmacyRecycleInventoryRow = {
  id: string
  sourceBadgeId: string
  quantity: number
}

export type PharmacyRecycleAllocation = {
  inventoryId: string
  sourceBadgeId: string
  quantity: number
}

export type PharmacyRecycleAllPlan = {
  totalQuantity: number
  batchCount: number
  recyclableCount: number
  rewardAmount: number
  recyclableTypeCount: number
  remainingQuantity: number
  allocations: PharmacyRecycleAllocation[]
}

/**
 * Reuse the campaign's existing recycle rule: each complete requiredCount
 * group earns one configured reward. Inventory is allocated in the same
 * oldest-first order used by the existing single-recycle operation.
 */
export function planPharmacyRecycleAll(
  inventory: readonly PharmacyRecycleInventoryRow[],
  requiredCount: number | null,
  rewardPerBatch: number | null,
  maxBatches = Number.MAX_SAFE_INTEGER,
): PharmacyRecycleAllPlan {
  const totalQuantity = inventory.reduce((total, row) => {
    if (!Number.isSafeInteger(row.quantity) || row.quantity < 0) throw new RangeError('INVALID_PHARMACY_DUPLICATE_QUANTITY')
    const next = total + row.quantity
    if (!Number.isSafeInteger(next)) throw new RangeError('PHARMACY_DUPLICATE_QUANTITY_OVERFLOW')
    return next
  }, 0)

  if (requiredCount === null || rewardPerBatch === null) {
    return { totalQuantity, batchCount: 0, recyclableCount: 0, rewardAmount: 0, recyclableTypeCount: 0, remainingQuantity: totalQuantity, allocations: [] }
  }
  if (!Number.isSafeInteger(requiredCount) || requiredCount <= 0 || !Number.isSafeInteger(rewardPerBatch) || rewardPerBatch <= 0) {
    throw new RangeError('INVALID_PHARMACY_RECYCLE_RULE')
  }
  if (!Number.isSafeInteger(maxBatches) || maxBatches <= 0) throw new RangeError('INVALID_PHARMACY_RECYCLE_BATCH_LIMIT')

  const batchCount = Math.min(Math.floor(totalQuantity / requiredCount), maxBatches)
  const recyclableCount = batchCount * requiredCount
  const rewardAmount = batchCount * rewardPerBatch
  if (!Number.isSafeInteger(recyclableCount) || !Number.isSafeInteger(rewardAmount)) throw new RangeError('PHARMACY_RECYCLE_TOTAL_OVERFLOW')

  let remaining = recyclableCount
  const allocations: PharmacyRecycleAllocation[] = []
  const recycledBadgeIds = new Set<string>()
  for (const row of inventory) {
    if (remaining <= 0) break
    const quantity = Math.min(row.quantity, remaining)
    if (quantity <= 0) continue
    allocations.push({ inventoryId: row.id, sourceBadgeId: row.sourceBadgeId, quantity })
    recycledBadgeIds.add(row.sourceBadgeId)
    remaining -= quantity
  }
  if (remaining !== 0) throw new Error('PHARMACY_RECYCLE_PLAN_INCONSISTENT')

  return {
    totalQuantity,
    batchCount,
    recyclableCount,
    rewardAmount,
    recyclableTypeCount: recycledBadgeIds.size,
    remainingQuantity: totalQuantity - recyclableCount,
    allocations,
  }
}
