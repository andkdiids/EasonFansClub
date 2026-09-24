import { buildFollowBackfillPlan } from '@/lib/follow-migration'
import { loadFollowBackfillSnapshot } from '@/lib/follow-migration-db'
import { insertMissingFollowEdges } from '@/lib/follow-backfill-service'
import { prisma } from '@/lib/prisma'

function printPlan(plan: ReturnType<typeof buildFollowBackfillPlan>, pendingFriendRequests: number) {
  console.log('=== FOLLOW MIGRATION PLAN ===')
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
  console.log(`REVERSED DUPLICATE PAIRS: ${plan.reversedDuplicatePairs}`)
  console.log(`PENDING FRIEND REQUESTS: ${pendingFriendRequests}`)
}

async function main() {
  const apply = process.argv.includes('--apply')
  const confirmApply = process.argv.includes('--confirm-apply')
  const allowProduction = process.argv.includes('--allow-production')

  if (apply && (!confirmApply || (process.env.NODE_ENV === 'production' && !allowProduction))) {
    throw new Error('APPLY requires --apply --confirm-apply; production also requires --allow-production')
  }

  const snapshot = await loadFollowBackfillSnapshot()
  const plan = buildFollowBackfillPlan(snapshot)
  printPlan(plan, snapshot.pendingFriendRequests)

  if (!apply) {
    console.log('MODE: DRY RUN (no writes)')
    return
  }

  const inserted = await prisma.$transaction(
    (tx) => insertMissingFollowEdges(tx, plan.backfillEdges),
    { timeout: 30_000, maxWait: 5_000 },
  )
  console.log('MODE: APPLY')
  console.log(`INSERTED FOLLOW ROWS: ${inserted}`)
}

main()
  .catch((error) => {
    console.error('[follow-migration] failed', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
