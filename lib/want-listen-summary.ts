export type OptionalWantListenRead<T> =
  | { value: T; available: true }
  | { value: T; available: false; reason: unknown }

/**
 * Convert an optional summary read into a value plus an availability flag.
 * The core game can continue with the supplied fallback when a secondary
 * summary query fails.
 */
export function settleOptionalWantListenRead<T>(result: PromiseSettledResult<T>, fallback: T): OptionalWantListenRead<T> {
  if (result.status === 'fulfilled') return { value: result.value, available: true }
  return { value: fallback, available: false, reason: result.reason }
}
