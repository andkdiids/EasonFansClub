import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ArtistProfile } from '@/components/studio/ArtistProfile'
import { getPublicArtistPage } from '@/lib/studio/public'
import { buildPageMetadata } from '@/lib/share-metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Readonly<{ params: Promise<{ slug: string }> }>): Promise<Metadata> {
  const { slug } = await params
  const page = await getPublicArtistPage(slug)
  return page
    ? buildPageMetadata({ title: `${page.artist.name} · 贝多芬与我`, description: page.artist.description || `浏览${page.artist.name}相关作品。`, canonical: `/artists/${encodeURIComponent(page.artist.slug)}` })
    : buildPageMetadata({ title: '艺术家 · 贝多芬与我', description: '查看贝多芬与我的艺术家主页。', canonical: '/artists' })
}

export default async function ArtistPage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params
  const page = await getPublicArtistPage(slug)
  if (!page) notFound()
  return <ArtistProfile artist={page.artist} projects={page.projects} />
}
