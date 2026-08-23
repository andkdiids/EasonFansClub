import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { streamProtectedGuessSongAudio } from '@/lib/protected-audio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ challengeId: string }> }

async function handle(request: Request, { params }: Context) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })
  const { challengeId } = await params
  const challenge = await prisma.makeupChallenge.findFirst({
    where: { id: challengeId, userId: user.id },
    select: { audioStoragePath: true },
  })
  if (!challenge) return NextResponse.json({ message: '挑战不存在' }, { status: 404 })
  return streamProtectedGuessSongAudio(request, challenge.audioStoragePath, { cacheControl: 'private, no-store' })
}

export async function GET(request: Request, context: Context) { return handle(request, context) }
export async function HEAD(request: Request, context: Context) { return handle(request, context) }
