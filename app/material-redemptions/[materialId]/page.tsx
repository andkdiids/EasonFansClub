import { MaterialRedemptionDetailClient } from './MaterialRedemptionDetailClient'

export const dynamic = 'force-dynamic'

export default async function MaterialRedemptionDetailPage({ params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await params
  return <MaterialRedemptionDetailClient materialId={materialId} />
}
