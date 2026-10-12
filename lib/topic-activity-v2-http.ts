import { NextResponse } from 'next/server'

export const topicV2Headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' }
export const topicV2IdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u

export function topicV2Json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: topicV2Headers })
}

export function topicV2ErrorResponse(error: unknown) {
  const domain = error as { code?: unknown; status?: unknown; message?: unknown } | null
  if (domain && typeof domain.code === 'string' && /^[A-Z][A-Z0-9_]{2,80}$/u.test(domain.code)
    && typeof domain.status === 'number' && domain.status >= 400 && domain.status < 500) {
    return topicV2Json({ code: domain.code, message: typeof domain.message === 'string' ? domain.message : '活动操作不可用' }, domain.status)
  }
  console.error('[topic-activity-v2.request.failed]', { errorName: error instanceof Error ? error.name : 'UNKNOWN' })
  return topicV2Json({ code: 'TOPIC_V2_OPERATION_FAILED', message: '操作失败，请稍后重试' }, 500)
}

export async function readTopicV2Body(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get('content-length')) > 262_144) return null
  const value: unknown = await request.json().catch(() => null)
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
