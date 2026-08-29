import { Prisma } from '@prisma/client'
import { getShanghaiDateKey, startOfLocalDay } from '@/lib/checkin'
import { CHECK_IN_MESSAGE_MAX_LENGTH } from '@/lib/checkin-message-constants'

export type CheckInMessageSupplementErrorCode =
  | 'INVALID_MESSAGE'
  | 'TODAY_CHECKIN_NOT_FOUND'
  | 'TODAY_CHECKIN_NOT_ELIGIBLE'
  | 'MESSAGE_ALREADY_EXISTS'
  | 'MESSAGE_ALREADY_SUPPLEMENTED'

export class CheckInMessageSupplementError extends Error {
  constructor(
    message: string,
    public readonly code: CheckInMessageSupplementErrorCode,
    public readonly status: 400 | 404 | 409 = 409,
  ) {
    super(message)
    this.name = 'CheckInMessageSupplementError'
  }
}

const checkInSelect = {
  id: true,
  checkDate: true,
  checkinDateKey: true,
  points: true,
  exp: true,
  mood: true,
  moodType: true,
  moodEmoji: true,
  moodText: true,
  message: true,
  streakDay: true,
  createdAt: true,
  type: true,
  isMakeUp: true,
  DailyMessage: { select: { id: true } },
} as const

type SupplementCheckIn = Prisma.CheckInGetPayload<{ select: typeof checkInSelect }>

export type CheckInMessageSupplementDatabase = Pick<
  Prisma.TransactionClient,
  'checkIn' | 'dailyMessage' | 'friendActivity'
>

export type CheckInMessageSupplementResult = {
  checkIn: Omit<SupplementCheckIn, 'DailyMessage'>
  dailyMessageId: string
}

/**
 * Supplement the current day's normal check-in without re-running check-in
 * creation or any reward/statistics side effects. The conditional update is
 * the one-time gate: concurrent requests cannot both change an empty message.
 */
export async function supplementTodayCheckInMessage(
  db: CheckInMessageSupplementDatabase,
  input: { userId: string; message: string; now?: Date },
): Promise<CheckInMessageSupplementResult> {
  const message = input.message.trim()
  if (!message || message.length > CHECK_IN_MESSAGE_MAX_LENGTH) {
    throw new CheckInMessageSupplementError('留言不能为空且最多 300 字', 'INVALID_MESSAGE', 400)
  }

  const now = input.now || new Date()
  const todayKey = getShanghaiDateKey(now)
  const today = startOfLocalDay(now)
  const existing = await db.checkIn.findUnique({
    where: { userId_checkinDateKey: { userId: input.userId, checkinDateKey: todayKey } },
    select: checkInSelect,
  })

  if (!existing) {
    throw new CheckInMessageSupplementError('今天还没有完成每日挂号', 'TODAY_CHECKIN_NOT_FOUND', 404)
  }

  if (existing.type !== 'NORMAL' || existing.isMakeUp) {
    throw new CheckInMessageSupplementError('当前挂号类型不支持补写留言', 'TODAY_CHECKIN_NOT_ELIGIBLE', 409)
  }

  if (existing.message?.trim()) {
    throw new CheckInMessageSupplementError('今天已经有留言，不能再次补写', 'MESSAGE_ALREADY_EXISTS', 409)
  }

  // A DailyMessage row is the existing public-wall projection. Keeping this
  // relation in the gate also prevents a soft-deleted projection from opening
  // a second supplement window after CheckIn.message was nulled by deletion.
  if (existing.DailyMessage) {
    throw new CheckInMessageSupplementError('今天的留言已经补写过，不能再次修改', 'MESSAGE_ALREADY_SUPPLEMENTED', 409)
  }

  const updated = await db.checkIn.updateMany({
    where: {
      id: existing.id,
      userId: input.userId,
      checkinDateKey: todayKey,
      type: 'NORMAL',
      isMakeUp: false,
      DailyMessage: { is: null },
      OR: [{ message: null }, { message: '' }],
    },
    data: { message },
  })

  if (updated.count !== 1) {
    throw new CheckInMessageSupplementError('今天的留言已经补写过，不能再次修改', 'MESSAGE_ALREADY_SUPPLEMENTED', 409)
  }

  const dailyMessage = await db.dailyMessage.create({
    data: {
      userId: input.userId,
      checkInId: existing.id,
      date: today,
      mood: existing.mood,
      moodType: existing.moodType,
      moodEmoji: existing.moodEmoji,
      moodText: existing.moodText,
      content: message,
      ipRegion: null,
      createdAt: now,
    },
    select: { id: true },
  })

  // The initial check-in background projection may already exist. Keep it in
  // sync when present; this write only mirrors the new message and does not
  // change rewards, streaks, balance, or the check-in mood.
  await db.friendActivity.updateMany({
    where: { checkInId: existing.id, actorId: input.userId },
    data: {
      dailyMessageId: dailyMessage.id,
      content: message,
      targetUrl: `/checkin?date=${todayKey}&message=${dailyMessage.id}`,
    },
  })

  const checkIn = {
    id: existing.id,
    checkDate: existing.checkDate,
    checkinDateKey: existing.checkinDateKey,
    points: existing.points,
    exp: existing.exp,
    mood: existing.mood,
    moodType: existing.moodType,
    moodEmoji: existing.moodEmoji,
    moodText: existing.moodText,
    message,
    streakDay: existing.streakDay,
    createdAt: existing.createdAt,
    type: existing.type,
    isMakeUp: existing.isMakeUp,
  }
  return { checkIn, dailyMessageId: dailyMessage.id }
}
