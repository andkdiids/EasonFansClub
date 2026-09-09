/**
 * MySQL VARCHAR(191) is used for persisted user-agent metadata.
 * Keep the normalization in one place so every write path has the same bound.
 */
export const STORED_USER_AGENT_MAX_LENGTH = 191

export function normalizeStoredUserAgent(value: string | null | undefined): string | null {
  if (!value) return null
  return value.slice(0, STORED_USER_AGENT_MAX_LENGTH)
}
