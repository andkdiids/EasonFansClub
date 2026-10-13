import { readFileSync } from 'node:fs'
import path from 'node:path'

export const TOPIC_LOTTERY_MIGRATION_PHASES = [
  '20261013120000_add_topic_activity_v2_lottery',
  '20261013121000_add_topic_lottery_winner_slot_column',
  '20261013122000_add_topic_lottery_winner_slot_index',
  '20261013123000_add_topic_lottery_winner_slot_fk',
] as const

/** Local QA fixture loader only; never executes SQL or repairs migration history. */
export function readTopicLotteryMigrationPhases(root = process.cwd()) {
  return TOPIC_LOTTERY_MIGRATION_PHASES.map((name) => ({ name,
    sql: readFileSync(path.join(root, 'prisma', 'migrations', name, 'migration.sql'), 'utf8'),
  }))
}
