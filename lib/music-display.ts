export function formatMusicReleaseDate(releaseDate: Date | null | undefined, releaseYear: number) {
  if (!releaseDate) return String(releaseYear)
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(releaseDate)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}/${value.month}/${value.day}`
}
