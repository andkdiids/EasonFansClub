import { Prisma } from '@prisma/client'

/**
 * The public hot-post formula is shared by the trending page and global
 * search. Keep it as SQL so both callers sort before applying their limit.
 */
export const POST_HOT_SCORE_SQL = Prisma.sql`(p.viewCount * 0.08 + p.likeCount * 3 + p.replyCount * 5 + p.favoriteCount * 4)`
