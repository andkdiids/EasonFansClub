function stripUnsafeText(value: string) {
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .trim()
}

/** Clean user text without imposing a length cap. */
export function sanitizeTextPreservingLength(value: unknown) {
  return stripUnsafeText(String(value ?? ''))
}
