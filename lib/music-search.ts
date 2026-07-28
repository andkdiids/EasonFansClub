export function buildMusicLyricSnippet(lyrics: string | null, query: string, radius = 42) {
  if (!lyrics || !query) return null
  const normalizedLyrics = lyrics.replace(/\s+/g, ' ').trim()
  const normalizedQuery = query.trim()
  if (!normalizedLyrics || !normalizedQuery) return null
  const index = normalizedLyrics.toLocaleLowerCase().indexOf(normalizedQuery.toLocaleLowerCase())
  if (index < 0) return null
  const start = Math.max(0, index - radius)
  const end = Math.min(normalizedLyrics.length, index + normalizedQuery.length + radius)
  return `${start > 0 ? '…' : ''}${normalizedLyrics.slice(start, end)}${end < normalizedLyrics.length ? '…' : ''}`
}
