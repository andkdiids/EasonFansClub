import { buildFollowBackfillPlan } from '@/lib/follow-migration'
import { loadFollowBackfillSnapshot } from '@/lib/follow-migration-db'
import { prisma } from '@/lib/prisma'

/**
 * Strictly read-only legacy friendship audit. This script intentionally does
 * not import the migration runner and contains no Prisma write operation.
 */
async function main() {
  const snapshot = await loadFollowBackfillSnapshot()
  const plan = buildFollowBackfillPlan(snapshot)

  console.log('=== FOLLOW MIGRATION DRY RUN (READ ONLY) ===')
  console.log(`OLD FRIEND COUNT: ${plan.oldFriendCount}`)
  console.log(`VALID FRIEND PAIRS: ${plan.validPairs}`)
  console.log(`EXPECTED FOLLOW ROWS: ${plan.expectedFollowRows}`)
  console.log(`EXISTING FOLLOW ROWS: ${plan.existingFollowRows}`)
  console.log(`WOULD INSERT A→B: ${plan.wouldInsertForward}`)
  console.log(`WOULD INSERT B→A: ${plan.wouldInsertReverse}`)
  console.log(`ALREADY EXISTING: ${plan.alreadyExisting}`)
  console.log(`BLOCKED RELATIONSHIPS: ${plan.blockedPairs}`)
  console.log(`INVALID RELATIONSHIPS: ${plan.invalidPairs}`)
  console.log(`SELF RELATIONSHIPS: ${plan.selfRelations}`)
  console.log(`DUPLICATE FRIEND PAIRS: ${plan.reversedDuplicatePairs}`)
  console.log(`REVERSED DUPLICATE PAIRS: ${plan.reversedDuplicatePairs}`)
  console.log(`PENDING FRIEND REQUESTS: ${snapshot.pendingFriendRequests}`)
}

main()
  .catch((error) => {
    console.error('[follow-migration-dry-run] failed', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
