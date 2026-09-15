import type { Metadata } from 'next'
import { loadMaterialShareCardData } from '@/lib/material-share-service'
import { buildPageMetadata } from '@/lib/share-metadata'
import { MaterialRedemptionDetailClient } from './MaterialRedemptionDetailClient'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ materialId: string }> }): Promise<Metadata> {
  const { materialId } = await params
  const data = await loadMaterialShareCardData(materialId)
  const canonical = `/material-redemptions/${encodeURIComponent(materialId)}`
  if (!data) return buildPageMetadata({ canonical, noindex: true })
  return buildPageMetadata({
    title: data.title,
    description: data.description,
    canonical,
    imageUrl: data.image,
  })
}

export default async function MaterialRedemptionDetailPage({ params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await params
  return <MaterialRedemptionDetailClient materialId={materialId} />
}
