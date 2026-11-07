import assert from 'node:assert/strict'
import test from 'node:test'
import { removeDailyMessageCommentLike, toggleDailyMessageCommentLike } from '../lib/daily-message-comment-like'

type FakeMessage = {
  isDeleted: boolean
  moderationStatus: string
  User: { isDeleted: boolean; status: string }
}

type FakeComment = {
  id: string
  isDeleted: boolean
  DailyMessage: FakeMessage | null
}

type FakeLike = { id: string; commentId: string; userId: string }

// 用内存态的假 Prisma 客户端驱动真实的点赞切换逻辑（不连数据库、不依赖模块 mock）。
function makeFakePrisma(opts: {
  comments?: Record<string, FakeComment>
  seedLikes?: FakeLike[]
  transactionError?: Error
} = {}) {
  const comments = opts.comments ?? {}
  let likes: FakeLike[] = opts.seedLikes ? opts.seedLikes.map((l) => ({ ...l })) : []
  let likeSeq = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fake: any = {
    $transaction: async (fn: (tx: unknown) => unknown) => {
      if (opts.transactionError) throw opts.transactionError
      return fn(fake)
    },
    dailyMessageComment: {
      findFirst: async ({ where }: { where: { id: string; isDeleted: boolean } }) => {
        const c = comments[where.id]
        if (!c || c.isDeleted !== where.isDeleted) return null
        return c
      },
    },
    dailyMessageCommentLike: {
      findUnique: async ({ where }: { where: { commentId_userId: { commentId: string; userId: string } } }) =>
        likes.find((l) => l.commentId === where.commentId_userId.commentId && l.userId === where.commentId_userId.userId) ?? null,
      create: async ({ data }: { data: { commentId: string; userId: string } }) => {
        const like = { id: `like-${++likeSeq}`, commentId: data.commentId, userId: data.userId }
        likes.push(like)
        return like
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const idx = likes.findIndex((l) => l.id === where.id)
        if (idx >= 0) likes.splice(idx, 1)
        return {}
      },
      deleteMany: async ({ where }: { where: { commentId: string; userId: string } }) => {
        const before = likes.length
        likes = likes.filter((l) => !(l.commentId === where.commentId && l.userId === where.userId))
        return { count: before - likes.length }
      },
      count: async ({ where }: { where: { commentId: string } }) => likes.filter((l) => l.commentId === where.commentId).length,
    },
  }
  return fake
}

const visibleMessage: FakeMessage = { isDeleted: false, moderationStatus: 'APPROVED', User: { isDeleted: false, status: 'ACTIVE' } }
const pendingMessage: FakeMessage = { isDeleted: false, moderationStatus: 'PENDING', User: { isDeleted: false, status: 'ACTIVE' } }
const bannedAuthorMessage: FakeMessage = { isDeleted: false, moderationStatus: 'APPROVED', User: { isDeleted: true, status: 'ACTIVE' } }

// 点赞目标 = focus 评论（commentId 本身），以下用例均针对 focus 评论可见性，与 parentId 无关。
test('点赞切换：可访问且未点赞 → 创建点赞并返回 isLiked:true、likeCount:1', async () => {
  const prisma = makeFakePrisma({ comments: { c1: { id: 'c1', isDeleted: false, DailyMessage: visibleMessage } } })
  assert.deepEqual(await toggleDailyMessageCommentLike(prisma, 'c1', 'u1'), { isLiked: true, likeCount: 1 })
})

test('点赞切换：可访问且已点赞 → 取消点赞并返回 isLiked:false、likeCount:0', async () => {
  const prisma = makeFakePrisma({
    comments: { c1: { id: 'c1', isDeleted: false, DailyMessage: visibleMessage } },
    seedLikes: [{ id: 'lk', commentId: 'c1', userId: 'u1' }],
  })
  assert.deepEqual(await toggleDailyMessageCommentLike(prisma, 'c1', 'u1'), { isLiked: false, likeCount: 0 })
})

test('评论删除（需求三⑥）：评论不存在 → 返回 null（路由据此回 404，不展示点赞按钮）', async () => {
  const prisma = makeFakePrisma({})
  assert.equal(await toggleDailyMessageCommentLike(prisma, 'missing', 'u1'), null)
})

test('评论删除：focus 评论已删除 → 返回 null', async () => {
  const prisma = makeFakePrisma({ comments: { c1: { id: 'c1', isDeleted: true, DailyMessage: visibleMessage } } })
  assert.equal(await toggleDailyMessageCommentLike(prisma, 'c1', 'u1'), null)
})

test('访问权限：所属每日留言未通过审核 → 返回 null', async () => {
  const prisma = makeFakePrisma({ comments: { c1: { id: 'c1', isDeleted: false, DailyMessage: pendingMessage } } })
  assert.equal(await toggleDailyMessageCommentLike(prisma, 'c1', 'u1'), null)
})

test('访问权限：所属留言作者账号已注销 → 返回 null', async () => {
  const prisma = makeFakePrisma({ comments: { c1: { id: 'c1', isDeleted: false, DailyMessage: bannedAuthorMessage } } })
  assert.equal(await toggleDailyMessageCommentLike(prisma, 'c1', 'u1'), null)
})

test('点赞计数：返回目标评论当前权威总数（含他人点赞）', async () => {
  const prisma = makeFakePrisma({
    comments: { c1: { id: 'c1', isDeleted: false, DailyMessage: visibleMessage } },
    seedLikes: [
      { id: 'a', commentId: 'c1', userId: 'other' },
      { id: 'b', commentId: 'c1', userId: 'other2' },
    ],
  })
  // u1 尚未点赞，点赞后总数为 3。
  assert.deepEqual(await toggleDailyMessageCommentLike(prisma, 'c1', 'u1'), { isLiked: true, likeCount: 3 })
})

test('取消点赞（DELETE）：移除当前用户点赞并返回 isLiked:false 与最新计数', async () => {
  const prisma = makeFakePrisma({
    comments: { c1: { id: 'c1', isDeleted: false, DailyMessage: visibleMessage } },
    seedLikes: [
      { id: 'a', commentId: 'c1', userId: 'u1' },
      { id: 'b', commentId: 'c1', userId: 'other' },
    ],
  })
  assert.deepEqual(await removeDailyMessageCommentLike(prisma, 'c1', 'u1'), { isLiked: false, likeCount: 1 })
})

test('取消点赞（DELETE）：评论不可访问 → 返回 null', async () => {
  const prisma = makeFakePrisma({ comments: { c1: { id: 'c1', isDeleted: true, DailyMessage: visibleMessage } } })
  assert.equal(await removeDailyMessageCommentLike(prisma, 'c1', 'u1'), null)
})

test('接口失败回滚：事务异常向上抛出（路由返回 500，客户端回滚乐观状态）', async () => {
  const prisma = makeFakePrisma({
    comments: { c1: { id: 'c1', isDeleted: false, DailyMessage: visibleMessage } },
    transactionError: new Error('db down'),
  })
  await assert.rejects(() => toggleDailyMessageCommentLike(prisma, 'c1', 'u1'), /db down/)
})
