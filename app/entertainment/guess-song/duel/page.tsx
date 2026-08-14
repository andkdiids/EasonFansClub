import { redirect } from 'next/navigation'

export default async function EntertainmentGuessSongDuelAlias({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') query.set(key, value)
    else if (Array.isArray(value) && value[0]) query.set(key, value[0])
  }
  const suffix = query.toString() ? `?${query.toString()}` : ''
  redirect(`/games/guess-song/duel${suffix}`)
}
