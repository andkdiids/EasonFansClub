import type { Metadata } from 'next'
import { StudioGallery } from '@/components/studio/StudioGallery'
import { listPublicStudioProjects } from '@/lib/studio/public'
import { buildPageMetadata } from '@/lib/share-metadata'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return buildPageMetadata({ title: '创作广场 · 贝多芬与我', description: '浏览贝多芬与我公开分享的创作作品。', canonical: '/studio/gallery' })
}

export default async function StudioGalleryPage() {
  const result = await listPublicStudioProjects({ sort: 'latest', page: 1, pageSize: 48 })
  return <StudioGallery initialProjects={result.projects} />
}
