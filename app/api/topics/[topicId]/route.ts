import { NextResponse } from 'next/server'
import { getTopicById, getTopicPosts } from '@/lib/topic-service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ topicId: string }> }) {
  const { topicId } = await params
  const query = new URL(request.url).searchParams
  const sort = query.get('sort') === 'hot' ? 'hot' as const : 'latest' as const
  const page = Math.max(1, Number.parseInt(query.get('page') || '1', 10) || 1)
  const topic = await getTopicById(topicId)
  if (!topic) return NextResponse.json({ message: '话题不存在' }, { status: 404 })
  const posts = await getTopicPosts(topicId, sort, page)
  return NextResponse.json({ topic, ...posts, sort }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}
