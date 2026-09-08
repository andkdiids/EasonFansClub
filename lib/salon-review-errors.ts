import { Prisma } from '@prisma/client'

export type SalonReviewFailureStage = 'LOAD' | 'VALIDATION' | 'DATABASE_UPDATE' | 'REWARD'

export type SalonReviewErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_REQUEST'
  | 'INVALID_REVIEW_ACTION'
  | 'POST_NOT_FOUND'
  | 'CATEGORY_INVALID'
  | 'CONCERT_SELECTION_INVALID'
  | 'CONCERT_NOT_ALLOWED'
  | 'SESSION_REQUIRED'
  | 'SESSION_NOT_FOUND'
  | 'CONCERT_NOT_FOUND'
  | 'REVIEW_NOT_ALLOWED'
  | 'REJECTION_REASON_REQUIRED'
  | 'NO_CHANGES'
  | 'ALREADY_REVIEWED'
  | 'REWARD_PROCESSING_ERROR'
  | 'DATABASE_ERROR'

export class SalonReviewError extends Error {
  readonly code: SalonReviewErrorCode
  readonly status: number

  constructor(code: SalonReviewErrorCode, message: string, status = 400) {
    super(message)
    this.name = 'SalonReviewError'
    this.code = code
    this.status = status
  }
}

export function toSalonReviewError(error: unknown, stage: SalonReviewFailureStage) {
  if (error instanceof SalonReviewError) return error

  if (error instanceof Prisma.PrismaClientValidationError) {
    return new SalonReviewError('INVALID_INPUT', '审核请求数据无效，请刷新后重试', 400)
  }

  if (error instanceof Error && error.message === 'SALON_POST_ALREADY_REVIEWED') {
    return new SalonReviewError('ALREADY_REVIEWED', '这篇作品已经被其他管理员处理，请刷新后重试', 409)
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025' && stage !== 'REWARD') {
    return new SalonReviewError('POST_NOT_FOUND', '作品不存在或已被删除', 404)
  }

  if (stage === 'REWARD') {
    return new SalonReviewError('REWARD_PROCESSING_ERROR', '审核奖励处理失败，审核未完成，请稍后重试', 500)
  }

  return new SalonReviewError('DATABASE_ERROR', '数据库操作未完成，请稍后重试', 500)
}
