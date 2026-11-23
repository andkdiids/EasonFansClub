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

type FirstPost = { id: string; excerpt: string; date: string }
type MemoirPeer = { id: string; nickname: string; wall: number; comments: number }

const postExcerpt = (post: { content: string; title: string }) => excerpt(post.content.replace(/<[^>]*>/g, ' ') || post.title) || excerpt(post.title)

export async function isFirstMemoirPostVisible(tx: Prisma.TransactionClient, userId: string, memory: FirstPost) {
  const post = await tx.post.findFirst({
    where: { ...memoryPostWhere(), id: memory.id, authorId: userId },
    select: { title: true, content: true },
  })
  return !!post && postExcerpt(post) === memory.excerpt
}

export async function collectFirstMemoirPost(tx: Prisma.TransactionClient, userId: string, range: Range, formatter: Intl.DateTimeFormat): Promise<FirstPost | null> {
  // Keep the historical first published row even when it is soft-deleted or moderated later.
  // Selecting from only currently visible posts would mislabel the second post.
  const post = await tx.post.findFirst({
    where: { authorId: userId, publishedAt: range, publicationStatus: 'PUBLISHED', concertShowId: null, TopicActivity: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, title: true, content: true, publishedAt: true },
  })
  if (!post?.publishedAt) return null
  const memory = { id: post.id, excerpt: postExcerpt(post), date: formatter.format(post.publishedAt) }
  return memory.excerpt && await isFirstMemoirPostVisible(tx, userId, memory) ? memory : null
}

function memoirPeerWhere(userId: string): Prisma.UserWhereInput {
  return {
    id: { not: userId }, status: 'ACTIVE', isDeleted: false,
    Profile: { is: { displayNameModerationStatus: 'NORMAL' } },
    Block_Block_blockedIdToUser: { none: { blockerId: userId } },
    Block_Block_blockerIdToUser: { none: { blockedId: userId } },
  }
}

export async function isMemoirPeerVisible(tx: Prisma.TransactionClient, userId: string, peer: MemoirPeer) {
  return !!await tx.user.findFirst({ where: { AND: [memoirPeerWhere(userId), { id: peer.id },
    ...(peer.comments ? [publicCommentHistory] : [])] }, select: { id: true } })
}

const publicCommentHistory = { OR: [{ UserPrivacySetting: null }, { UserPrivacySetting: { showComments: true } }] } satisfies Prisma.UserWhereInput

export async function collectMemoirPeer(tx: Prisma.TransactionClient, userId: string, range: Range): Promise<MemoirPeer | null> {
  const users = memoirPeerWhere(userId)
  const [wall, comments] = await Promise.all([
    tx.profileWallMessage.groupBy({ by: ['senderId'], where: {
      receiverId: userId, parentId: null, createdAt: range, deletedAt: null, moderationStatus: 'NORMAL',
      User_ProfileWallMessage_senderIdToUser: users,
    }, _count: { _all: true }, _min: { createdAt: true } }),
    tx.reply.groupBy({ by: ['authorId'], where: {
      parentId: null, createdAt: range, isDeleted: false, moderationStatus: 'NORMAL', TopicActivitySubmission: null,
      User: { AND: [users, publicCommentHistory] }, Post: { ...memoryPostWhere(), authorId: userId, TopicActivity: null },
    }, _count: { _all: true }, _min: { createdAt: true } }),
  ])
  const counts = new Map<string, { wall: number; comments: number; first: number }>()
  for (const [metric, rows] of [['wall', wall.map((row) => ({ ...row, id: row.senderId }))],
    ['comments', comments.map((row) => ({ ...row, id: row.authorId }))]] as const) {
    for (const row of rows) {
      const current = counts.get(row.id) ?? { wall: 0, comments: 0, first: Infinity }
      current[metric] = row._count._all
      current.first = Math.min(current.first, row._min.createdAt?.getTime() ?? Infinity)
      counts.set(row.id, current)
    }
  }
  if (!counts.size) return null
  const peers = await tx.user.findMany({ where: { id: { in: [...counts.keys()] } }, select: { id: true, uid: true, nickname: true } })
  const sorted = peers.map((peer) => ({ ...peer, ...counts.get(peer.id)! }))
    .sort((a, b) => (b.wall + b.comments) - (a.wall + a.comments) || a.first - b.first || a.uid - b.uid)
  const peer = sorted[0]
  return peer ? { id: peer.id, nickname: peer.nickname, wall: peer.wall, comments: peer.comments } : null
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
