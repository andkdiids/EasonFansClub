import { NextResponse } from 'next/server'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'
import { requireRequestUser } from '@/lib/security'
import {
  downloadTopicActivityPreview,
  parseTopicActivityPreviewVariant,
  topicActivityPreviewObjectPathForAsset,
} from '@/lib/topic-activity-image-preview'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ activityId: string; assetId: string }> }

const ID_PATTERN = /^[A-Za-z0-9_-]{1,191}$/u

function denied() {
  return NextResponse.json({ message: '图片预览不存在' }, { status: 404, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { activityId, assetId } = await context.params
  if (![activityId, assetId].every((value) => ID_PATTERN.test(value))) return denied()

  const asset = await prisma.topicActivityImageAsset.findFirst({
    where: { id: assetId, activityId },
    select: {
      id: true,
      activityId: true,
      uploadedByUserId: true,
      purpose: true,
      storageKey: true,
      FormSubmission: { select: { userId: true } },
      Reply: { select: { Submission: { select: { userId: true } } } },
    },
  })
  if (!asset || !topicActivityPreviewObjectPathForAsset(asset.storageKey, activityId, asset.purpose, 'preview')) return denied()

  const isUploader = asset.uploadedByUserId === guard.user.id
  const isSubmissionOwner = asset.FormSubmission?.userId === guard.user.id || asset.Reply?.Submission?.userId === guard.user.id
  const isAdmin = await hasAdminPermission(guard.user, 'activity_manage').catch(() => false)
  if (!isUploader && !isSubmissionOwner && !isAdmin) return denied()

  const variant = parseTopicActivityPreviewVariant(new URL(request.url).searchParams.get('variant'))
  if (!variant) return denied()
  return downloadTopicActivityPreview(asset, activityId, asset.id, asset.purpose, variant)
}
