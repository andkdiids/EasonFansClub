import { fileURLToPath } from 'node:url'
import path from 'node:path'

export function assertNativeBearerRollbackResult({
  expectedProductionSha,
  expectedRollbackSha,
  rollbackResult,
  verifiedRollbackSha,
  publicHealthSha,
}) {
  if (!/^[0-9a-f]{40}$/.test(expectedProductionSha ?? '')
    || !/^[0-9a-f]{40}$/.test(expectedRollbackSha ?? '')
    || expectedProductionSha === expectedRollbackSha) {
    throw new Error('ROLLBACK_EXPECTED_SHA_INVALID')
  }
  if (rollbackResult !== 'RESTORED' || verifiedRollbackSha !== expectedRollbackSha) {
    throw new Error('ROLLBACK_SERVER_SHA_NOT_VERIFIED')
  }
  if (publicHealthSha !== expectedRollbackSha) throw new Error('ROLLBACK_PUBLIC_HEALTH_SHA_NOT_VERIFIED')
  return { status: 'VERIFIED', sha: expectedRollbackSha }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const result = assertNativeBearerRollbackResult({
      expectedProductionSha: process.env.EXPECTED_PRODUCTION_SHA,
      expectedRollbackSha: process.env.EXPECTED_ROLLBACK_SHA,
      rollbackResult: process.env.ROLLBACK_RESULT,
      verifiedRollbackSha: process.env.VERIFIED_ROLLBACK_SHA,
      publicHealthSha: process.env.PUBLIC_HEALTH_SHA,
    })
    console.log(`NATIVE_BEARER_ROLLBACK=${result.status}\nPRODUCTION_HEALTH_SHA=${result.sha}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'ROLLBACK_RESULT_INVALID')
    process.exitCode = 1
  }
}
