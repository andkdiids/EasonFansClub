import { redirect } from 'next/navigation'

type PageProps = { searchParams?: Promise<{ session?: string }> }

export default async function GuessSongPage({ searchParams }: PageProps) {
  const query = await searchParams
  redirect(query?.session
    ? `/games/guess-song/play?session=${encodeURIComponent(query.session)}&from=detail`
    : '/games/guess-song')
}
