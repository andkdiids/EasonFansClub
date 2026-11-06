export const TEST_FILE_SUFFIX: string
export const DEFAULT_SHARD_COUNT: number
export const DEFAULT_TEST_TIMEOUT_MS: number
export const DEFAULT_MAX_WALL_MS: number

export function listTestFiles(repoRoot: string): string[]

export function planShards(files: readonly string[], shardCount: number): string[][]

export interface ShardCoverageReport {
  ok: boolean
  totalFiles: number
  coveredFiles: number
  shardCounts: number[]
  duplicated: Array<{ file: string; first: number; again: number }>
  missing: string[]
  extra: string[]
  emptyShards: Array<{ index: number; count: number }>
}

export function verifyCoverage(
  shards: readonly (readonly string[])[],
  allFiles: readonly string[],
): ShardCoverageReport

export function parseTapFailures(tapText: string): string[]
