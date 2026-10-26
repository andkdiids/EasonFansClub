import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ConcertEventPage } from '@/components/concerts/ConcertEventPage'
import { getCurrentUser } from '@/lib/auth'
import { getPublicConcertEvent, safeEventSlug } from '@/lib/concert-events'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const safeSlug = safeEventSlug(slug)
  if (!safeSlug) return { title: '演唱会专题' }
  try {
    const event = await getPublicConcertEvent(safeSlug)
    return { title: event?.title || '演唱会专题', description: event?.sourceNote || '私家E院演唱会专题' }
  } catch { return { title: '演唱会专题' } }
}

export default async function ConcertEventRoute({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug: rawSlug }, user] = await Promise.all([params, getCurrentUser()])
  const slug = safeEventSlug(rawSlug)
  if (!slug) notFound()
  try {
    const event = await getPublicConcertEvent(slug, user?.id)
    if (!event) notFound()
    return <ConcertEventPage initialEvent={event} isAuthenticated={Boolean(user)} />
  } catch {
    return <main className="site-page-main mx-auto max-w-3xl px-4 py-12"><div className="border border-[var(--border)] bg-[var(--surface)] p-6"><h1 className="text-xl font-black text-[var(--foreground)]">专题暂时无法加载</h1><p className="mt-2 text-sm text-[var(--foreground-muted)]">演唱会专题数据尚未准备好或服务暂时不可用，请稍后再试。</p></div></main>
  }
}
