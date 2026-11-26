/**
 * DB-backed settings accessor for automatic leaderboard rewards.
 *
 * Single row (id=1) JSON config, mirroring ShunMasterSettings. Reads always
 * validate and fall back to the published defaults so a missing/legacy row is
 * safe. Writes bump rulesVersion and are guarded by the admin permission layer
 * at the API boundary (this module never authorizes).
 */

import type { Prisma } from '@prisma/client'
import {
  defaultLeaderboardRewardsConfig,
  leaderboardRewardsConfigError,
  validateLeaderboardRewardsConfig,
  type LeaderboardRewardsConfig,
} from '@/lib/leaderboard-rewards-config'
import { prisma } from '@/lib/prisma'

const SETTINGS_ID = 1

export async function getLeaderboardRewardsConfig(
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<LeaderboardRewardsConfig> {
  const row = await db.leaderboardRewardSettings.findUnique({ where: { id: SETTINGS_ID } })
  return validateLeaderboardRewardsConfig(row?.config) ?? { ...defaultLeaderboardRewardsConfig }
}

/** Read the config plus the persisted rulesVersion (for cache/audit display). */
export async function getLeaderboardRewardsSettings() {
  const row = await prisma.leaderboardRewardSettings.findUnique({ where: { id: SETTINGS_ID } })
  return {
    config: validateLeaderboardRewardsConfig(row?.config) ?? { ...defaultLeaderboardRewardsConfig },
    rulesVersion: row?.rulesVersion ?? 0,
    error: row ? leaderboardRewardsConfigError(row.config) : null,
  }
}

/**
 * Persist a validated config. Callers must validate the draft first with
 * leaderboardRewardsConfigError / validateLeaderboardRewardsConfig.
 */
export async function updateLeaderboardRewardsConfig(
  config: LeaderboardRewardsConfig,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const existing = await db.leaderboardRewardSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { rulesVersion: true },
  })
  const rulesVersion = (existing?.rulesVersion ?? 0) + 1
  await db.leaderboardRewardSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, config: config as unknown as Prisma.InputJsonValue, rulesVersion },
    update: { config: config as unknown as Prisma.InputJsonValue, rulesVersion },
  })
  return { config, rulesVersion }
}
