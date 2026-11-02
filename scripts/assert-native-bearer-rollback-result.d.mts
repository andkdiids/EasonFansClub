export function assertNativeBearerRollbackResult(input: {
  expectedProductionSha: string
  expectedRollbackSha: string
  rollbackResult: string
  verifiedRollbackSha: string
  publicHealthSha: string
}): { status: 'VERIFIED'; sha: string }
