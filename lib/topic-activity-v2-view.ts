/** Public task label only. Private review notes and screenshot keys never enter this DTO. */
export function topicV2SafeRewardSnapshot(value: unknown) {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const nested = record.entry && typeof record.entry === 'object' && !Array.isArray(record.entry) ? record.entry as Record<string, unknown> : record
  return {
    platformName: typeof nested.platformName === 'string' ? nested.platformName : '',
    title: typeof nested.title === 'string' ? nested.title : '',
    points: typeof nested.points === 'number' && Number.isSafeInteger(nested.points) ? nested.points : 0,
    instructions: typeof nested.instructions === 'string' ? nested.instructions : '',
  }
}
