export function assertReleaseMainBranch(input: {
  branch: { name?: string; protected?: boolean; commit?: { sha?: string } } | null | undefined
  expectedSha: string
  ref: string
}): { protected: true; sha: string }

export function verifyReleaseMainBranch(input?: {
  apiUrl?: string
  repository?: string
  token?: string
  expectedSha?: string
  ref?: string
  fetchImpl?: typeof fetch
}): Promise<{ protected: true; sha: string }>
