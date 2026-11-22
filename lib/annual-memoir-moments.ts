import type { Prisma } from '@prisma/client'
import { buildPublicPostWhere } from '@/lib/post-moderation'
import { getGuessSongDeletedSessionIds } from '@/lib/guess-song-leaderboard'

type Range = { gte: Date; lt: Date }
type Memory = { id: string; kind: 'POST' | 'REPLY'; excerpt: string; date: string }

function excerpt(text: string) {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, 72).join('')
}

function memoryPostWhere() {
  return { ...buildPublicPostWhere(), moderationStatus: 'APPROVED', Board: { isActive: true } } satisfies Prisma.PostWhereInput
}

export async function collectCommunityMemory(tx: Prisma.TransactionClient, userId: string, range: Range, formatter: Intl.DateTimeFormat): Promise<Memory | null> {
  const publicPost = memoryPostWhere()
  const post = await tx.post.findFirst({
    where: { ...publicPost, authorId: userId, publishedAt: range, NOT: { title: '' } },
    // Later likes must not change the selection for a closed reporting period.
    orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
    select: { id: true, title: true, publishedAt: true },
  })
  if (post?.publishedAt && excerpt(post.title)) {
    return { id: post.id, kind: 'POST', excerpt: excerpt(post.title), date: formatter.format(post.publishedAt) }
  }
  const reply = await tx.reply.findFirst({
    where: { authorId: userId, createdAt: range, isDeleted: false, moderationStatus: 'NORMAL', Post: publicPost,
      TopicActivitySubmission: null, parentId: null, NOT: { content: '' } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: { id: true, content: true, createdAt: true },
  })
  return reply && excerpt(reply.content)
    ? { id: reply.id, kind: 'REPLY', excerpt: excerpt(reply.content), date: formatter.format(reply.createdAt) }
    : null
}

export async function isMemoirMemoryVisible(tx: Prisma.TransactionClient, userId: string, memory: Memory) {
  const publicPost = memoryPostWhere()
  if (memory.kind === 'POST') {
    const post = await tx.post.findFirst({
      where: { ...publicPost, id: memory.id, authorId: userId }, select: { title: true },
    })
    return !!post && excerpt(post.title) === memory.excerpt
  }
  if (memory.kind !== 'REPLY') return false
  const reply = await tx.reply.findFirst({
    where: { id: memory.id, authorId: userId, isDeleted: false, moderationStatus: 'NORMAL', Post: publicPost,
      TopicActivitySubmission: null, parentId: null }, select: { content: true },
  })
  return !!reply && excerpt(reply.content) === memory.excerpt
}

const soloModes = { EASY: '简单', ADVANCED: '进阶', HARD: '困难', EXPERT: '专家', ENDLESS: '无尽' }
const wantListenModes = { WANT_LISTEN: '想听', CANTONESE_FRAGMENT: '粤语残片', FALSE_TITLE: '防不胜防' }

export async function collectBestGame(tx: Prisma.TransactionClient, userId: string, range: Range) {
  const excludedSoloSessions = await getGuessSongDeletedSessionIds({}, tx)
  const [solo, wantListen, duel] = await Promise.all([
    tx.guessSongSession.findFirst({
      where: { userId, completedAt: range, status: 'COMPLETED', isValid: true, invalidatedAt: null,
        id: { notIn: [...excludedSoloSessions] } },
      orderBy: [{ score: 'desc' }, { completedAt: 'asc' }, { id: 'asc' }], select: { score: true, mode: true },
    }),
    tx.wantListenSession.findFirst({
      where: { userId, completedAt: range, status: 'COMPLETED', antiCheatStatus: 'CLEAN', excludedFromLeaderboard: false },
      orderBy: [{ score: 'desc' }, { completedAt: 'asc' }, { id: 'asc' }], select: { score: true, mode: true },
    }),
    tx.guessSongDuelPlayer.findFirst({
      where: { userId, suspicious: false, Match: { status: 'FINISHED', finishedAt: range, isSuspicious: false,
        finishReason: { in: ['SCORE_THRESHOLD', 'ALL_QUESTIONS', 'TIEBREAKER'] } } },
      orderBy: [{ correctCount: 'desc' }, { id: 'asc' }],
      select: { correctCount: true, Match: { select: { mode: true } } },
    }),
  ])
  // Undercover awards XP and stores wins; neither is a single-game score.
  const scores = [
    solo && { score: solo.score, mode: '听听 · ' + soloModes[solo.mode] },
    wantListen && { score: wantListen.score, mode: wantListenModes[wantListen.mode] },
    duel && { score: duel.correctCount, mode: '听听 1v1 · ' + (duel.Match.mode === 'BUZZER' ? '抢答' : '计分') },
  ].filter((score) => score !== null)
  return scores.sort((left, right) => right.score - left.score)[0] ?? null
}
