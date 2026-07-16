import { redirect } from 'next/navigation'

export default async function LegacyBoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  redirect(`/forum?board=${encodeURIComponent(slug)}`)
}
