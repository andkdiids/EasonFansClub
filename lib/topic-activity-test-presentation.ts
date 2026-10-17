import type { TopicActivityV2Test } from '@/lib/topic-activity-v2-config'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}

/** Only the image and poster options are presentation. Answers, weights and score ranges remain protected. */
export function topicActivityTestStructure(test: TopicActivityV2Test) {
  const structure = { ...test, results: test.results.map((result) => {
    const value = { ...result }
    delete value.imageUrl
    return value
  }) }
  // Keep the original object intact, including legacy background values and immutable attempt snapshots.
  // A version marker is not test content. It must not by itself trigger another version bump.
  const { poster: presentation, version: _version, ...protectedStructure } = structure
  void presentation
  void _version
  return protectedStructure
}

export function topicActivityTestDirty(before: TopicActivityV2Test, after: TopicActivityV2Test) {
  return {
    TEST_STRUCTURE_DIRTY: canonical(topicActivityTestStructure(before)) !== canonical(topicActivityTestStructure(after)),
    RESULT_PRESENTATION_DIRTY: canonical(before.results.map((result) => ({ id: result.id, imageUrl: result.imageUrl || null }))) !== canonical(after.results.map((result) => ({ id: result.id, imageUrl: result.imageUrl || null }))),
    SHARE_SETTINGS_DIRTY: canonical(before.poster) !== canonical(after.poster),
  }
}
