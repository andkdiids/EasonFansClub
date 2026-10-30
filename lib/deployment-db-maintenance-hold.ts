import { lstatSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * A deployment may set this file while switching an app-only release so that
 * newly started production processes do not immediately run maintenance jobs.
 * Missing is the normal state; unexpected filesystem errors fail closed.
 */
export function isDeploymentDbMaintenanceHeld(
  holdFile = process.env.DEPLOY_DB_MAINTENANCE_HOLD_FILE?.trim() || '',
) {
  if (!holdFile) return false

  try {
    lstatSync(holdFile)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true

    // A missing file is the normal state, but a missing or invalid parent
    // directory must not silently re-enable maintenance during deployment.
    try {
      return !statSync(path.dirname(holdFile)).isDirectory()
    } catch {
      return true
    }
  }
}

export function isDbMaintenanceAllowed(isHeld = isDeploymentDbMaintenanceHeld) {
  return !isHeld()
}
