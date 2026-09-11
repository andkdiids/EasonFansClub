import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CreatorProfile } from '@/components/studio/CreatorProfile'
import { creatorPath } from '@/lib/studio/artists'
import { getPublicCreatorPage } from '@/lib/studio/public'
import { buildPageMetadata } from '@/lib/share-metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Readonly<{ params: Promise<{ userId: string }> }>): Promise<Metadata> {
  const { userId } = await params
  const page = await getPublicCreatorPage(userId)
  return page
    ? buildPageMetadata({ title: `${page.creator.name} · 拼豆作品`, description: page.creator.description || `浏览${page.creator.name}创建的公开拼豆作品。`, canonical: creatorPath(page.creator.uid) })
    : buildPageMetadata({ title: '拼豆作者 · 贝多芬与我', description: '查看用户创建的公开拼豆作品。', canonical: '/studio/gallery' })
}

export default async function CreatorPage({ params }: Readonly<{ params: Promise<{ userId: string }> }>) {
  const { userId } = await params
  const page = await getPublicCreatorPage(userId)
  if (!page) notFound()
  return <CreatorProfile creator={page.creator} projects={page.projects} />
}
