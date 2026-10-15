const ACTIVITY_SOURCE_PATH = /(?:^|\/)activities\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/source\.webp$/iu

/** Convert a trusted activity-image upload result to the existing COS proxy form. */
export function topicActivityPosterBackgroundPath(value: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(value, 'https://ecfc.fans')
  } catch {
    return null
  }
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password || parsed.search || parsed.hash) return null

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }
  if (decodedPath.includes('..') || decodedPath.includes('\\') || /[\x00]/u.test(decodedPath)) return null
  const match = decodedPath.match(ACTIVITY_SOURCE_PATH)
  if (!match) return null
  return `/cos/activities/${match[1]}/source.webp`
}
