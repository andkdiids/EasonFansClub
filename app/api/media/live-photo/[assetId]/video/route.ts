import { deliverLivePhoto } from '@/lib/live-photo-delivery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ assetId: string }> }

export async function GET(request: Request, context: RouteContext) {
  const { assetId } = await context.params
  return deliverLivePhoto(request, assetId, 'video')
}
