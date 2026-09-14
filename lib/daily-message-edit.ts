import { Prisma } from '@prisma/client'
import { getShanghaiDateKey } from '@/lib/checkin'
import { CHECK_IN_MESSAGE_MAX_LENGTH } from '@/lib/checkin-message-constants'
import { syncDailyMessageContentEffects } from '@/lib/daily-message-deletion'

export type DailyMessageEditErrorCode =
  | 'INVALID_MESSAGE'
  | 'MESSAGE_NOT_FOUND'
  | 'FORBIDDEN'
  | 'MESSAGE_NOT_ELIGIBLE'
  | 'EDIT_ALREADY_USED'

export class DailyMessageEditError extends Error {
  constructor(
    message: string,
    public readonly code: DailyMessageEditErrorCode,
    public readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message)
    this.name = 'DailyMessageEditError'
  }
}

const dailyMessageEditSelect = {
  id: true,
  userId: true,
  date: true,
  content: true,
  isDeleted: true,
  checkInId: true,
  editedAt: true,
  createdAt: true,
  CheckIn: { select: { userId: true, checkinDateKey: true, type: true, isMakeUp: true } },
} as const

type DailyMessageEditDatabase = Pick<Prisma.TransactionClient, 'dailyMessage' | 'checkIn' | 'friendActivity'>
type DailyMessageEditRow = Prisma.DailyMessageGetPayload<{ select: typeof dailyMessageEditSelect }>

export type DailyMessageEditResult = {
  id: string
  content: string
  date: Date
  editedAt: Date
  createdAt: Date
}

function invalidMessage(message: string) {
  if (!message || message.length > CHECK_IN_MESSAGE_MAX_LENGTH) {
    throw new DailyMessageEditError('留言不能为空且最多 300 字', 'INVALID_MESSAGE', 400)
  }
}

function assertEditableToday(row: DailyMessageEditRow, userId: string, now: Date) {
  const todayKey = getShanghaiDateKey(now)
  const isToday = getShanghaiDateKey(row.date) === todayKey
  const checkIn = row.CheckIn
  if (!row.checkInId || !checkIn || checkIn.userId !== userId || checkIn.checkinDateKey !== todayKey || !isToday || checkIn.type !== 'NORMAL' || checkIn.isMakeUp) {
    throw new DailyMessageEditError('只能编辑今天的挂号留言', 'MESSAGE_NOT_ELIGIBLE', 409)
  }
}

/**
 * Atomically consumes the one edit slot on the existing DailyMessage row.
 * The editedAt IS NULL predicate is the concurrency gate: two tabs can both
 * read an editable row, but only one conditional update can affect it.
 */
export async function editDailyMessageForOwner(
  db: DailyMessageEditDatabase,
  input: { messageId: string; userId: string; content: string; now?: Date },
): Promise<DailyMessageEditResult> {
  const content = input.content.trim()
  invalidMessage(content)
  const now = input.now || new Date()

  const existing = await db.dailyMessage.findUnique({
    where: { id: input.messageId },
    select: dailyMessageEditSelect,
  })
  if (!existing) throw new DailyMessageEditError('挂号留言不存在', 'MESSAGE_NOT_FOUND', 404)
  if (existing.userId !== input.userId) throw new DailyMessageEditError('只能编辑自己的挂号留言', 'FORBIDDEN', 403)
  if (existing.isDeleted) throw new DailyMessageEditError('挂号留言不存在', 'MESSAGE_NOT_FOUND', 404)
  if (existing.editedAt) throw new DailyMessageEditError('该挂号留言的编辑机会已使用', 'EDIT_ALREADY_USED', 409)

  assertEditableToday(existing, input.userId, now)

  const updated = await db.dailyMessage.updateMany({
    where: {
      id: input.messageId,
      userId: input.userId,
      isDeleted: false,
      editedAt: null,
    },
    data: { content, editedAt: now },
  })

  if (updated.count !== 1) {
    const latest = await db.dailyMessage.findUnique({
      where: { id: input.messageId },
      select: { userId: true, isDeleted: true, editedAt: true },
    })
    if (!latest || latest.isDeleted) throw new DailyMessageEditError('挂号留言不存在', 'MESSAGE_NOT_FOUND', 404)
    if (latest.userId !== input.userId) throw new DailyMessageEditError('只能编辑自己的挂号留言', 'FORBIDDEN', 403)
    throw new DailyMessageEditError('该挂号留言的编辑机会已使用', 'EDIT_ALREADY_USED', 409)
  }

  const updatedRow = await db.dailyMessage.findUnique({
    where: { id: input.messageId },
    select: { id: true, content: true, date: true, editedAt: true, createdAt: true, userId: true, checkInId: true },
  })
  if (!updatedRow?.editedAt) throw new DailyMessageEditError('留言修改失败，请稍后重试', 'EDIT_ALREADY_USED', 409)

  await syncDailyMessageContentEffects(db, updatedRow)
  return {
    id: updatedRow.id,
    content: updatedRow.content,
    date: updatedRow.date,
    editedAt: updatedRow.editedAt,
    createdAt: updatedRow.createdAt,
  }
}
