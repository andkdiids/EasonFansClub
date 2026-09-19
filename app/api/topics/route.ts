import { NextResponse } from 'next/server'
import { findTopics } from '@/lib/topic-service'
import { normalizeTopicName } from '@/lib/post-topics'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams.get('search') || ''
  const topics = await findTopics(search)
  return NextResponse.json({ topics }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as { name?: unknown } | null
  const name = normalizeTopicName(body?.name)
  if (!name) return NextResponse.json({ message: '话题名称只能包含中文、英文、数字或下划线' }, { status: 400 })
  const topic = await prisma.topic.upsert({
    where: { normalizedName: name.toLocaleLowerCase('en-US') },
    update: {},
    create: { name, normalizedName: name.toLocaleLowerCase('en-US'), createdById: guard.user.id },
    select: { id: true, name: true, normalizedName: true, isOfficial: true },
  })
  return NextResponse.json({ topic }, { status: 201 })
}
