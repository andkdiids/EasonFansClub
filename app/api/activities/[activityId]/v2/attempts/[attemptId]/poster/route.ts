import { NextResponse } from 'next/server'
import { requireRequestUser } from '@/lib/security'
import { getTopicV2Attempt } from '@/lib/topic-activity-v2-interactive'
import { renderTopicV2Poster } from '@/lib/topic-activity-v2-poster'
import { topicV2ErrorResponse, topicV2Headers } from '@/lib/topic-activity-v2-http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ activityId: string; attemptId: string }> }) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { activityId, attemptId } = await context.params
  try {
    const attempt = await getTopicV2Attempt(activityId, attemptId, guard.user.id)
    const png = await renderTopicV2Poster(attempt.resultSnapshot, activityId)
    return new NextResponse(png as unknown as BodyInit, { headers: { ...topicV2Headers, 'Content-Type': 'image/png', 'Content-Length': String(png.length),
      'Content-Disposition': 'inline; filename="activity-result.png"', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) { return topicV2ErrorResponse(error) }
}
