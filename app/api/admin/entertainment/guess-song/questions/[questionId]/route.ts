import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  canEnableGuessSongQuestion,
  getRequiredGuessSongDurations,
  parseGuessSongQuestionInput,
} from '@/lib/guess-song-questions'
import {
  deleteGuessSongObjects,
  guessSongObjectExists,
} from '@/lib/guess-song-storage'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'

type Context = { params: Promise<{ questionId: string }> }

export const runtime = 'nodejs'

export async function PATCH(request: Request, { params }: Context) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有题库管理权限', guard.response.status)
  const { questionId } = await params
  const parsed = parseGuessSongQuestionInput(await request.json().catch(() => null))
  if (!parsed.ok) return guessSongError(parsed.error, 400)

  try {
    const current = await prisma.guessSongQuestion.findUnique({
      where: { id: questionId },
      include: { GuessSongAudioVariant: { select: { durationSeconds: true, storagePath: true } } },
    })
    if (!current) return guessSongError('题目不存在', 404)
    if (parsed.data.musicSongId) {
      const song = await prisma.musicSong.findUnique({ where: { id: parsed.data.musicSongId }, select: { id: true } })
      if (!song) return guessSongError('关联的 EasMusic 歌曲不存在', 400)
    }
    if (parsed.data.enabled && !canEnableGuessSongQuestion({
      processingStatus: current.processingStatus,
      difficulty: parsed.data.difficulty,
      allowEndless: parsed.data.allowEndless,
      variantDurations: current.GuessSongAudioVariant.map((variant) => variant.durationSeconds),
    })) {
      return guessSongError('题目音频尚未就绪，或缺少当前模式需要的音频变体', 409)
    }
    if (parsed.data.enabled) {
      const requiredDurations = getRequiredGuessSongDurations(
        parsed.data.difficulty,
        parsed.data.allowEndless,
      )
      const requiredKeys = requiredDurations.map((duration) =>
        current.GuessSongAudioVariant.find((variant) => variant.durationSeconds === duration)?.storagePath,
      )
      const existing = await Promise.all(requiredKeys.map((key) => key
        ? guessSongObjectExists(key)
        : Promise.resolve(false)))
      if (existing.some((value) => !value)) {
        return guessSongError('题目对应的腾讯云 COS 音频对象缺失，请重新上传或生成音频', 409)
      }
    }
    const question = await prisma.guessSongQuestion.update({
      where: { id: questionId },
      data: parsed.data,
      include: { GuessSongAudioVariant: { orderBy: { durationSeconds: 'asc' } }, MusicSong: true },
    })
    const { GuessSongAudioVariant, ...questionData } = question
    return guessSongOk({ question: { ...questionData, audioVariants: GuessSongAudioVariant } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return guessSongError('题目不存在', 404)
    }
    return handleGuessSongError(error, 'admin.questions.update')
  }
}

export async function DELETE(request: Request, { params }: Context) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有题库管理权限', guard.response.status)
  const { questionId } = await params

  try {
    const question = await prisma.guessSongQuestion.findUnique({
      where: { id: questionId },
      include: {
        _count: { select: { GuessSongSessionQuestion: true } },
        GuessSongAudioVariant: { select: { storagePath: true } },
      },
    })
    if (!question) return guessSongError('题目不存在', 404)
    if (question._count.GuessSongSessionQuestion > 0) {
      return guessSongError('该题目已有历史游戏记录，请停用而不是删除', 409)
    }
    const paths = [
      ...(question.sourceAudioPath ? [question.sourceAudioPath] : []),
      ...question.GuessSongAudioVariant.map((variant) => variant.storagePath),
    ]
    await deleteGuessSongObjects(paths)
    await prisma.guessSongQuestion.delete({ where: { id: questionId } })
    return guessSongOk({ id: questionId })
  } catch (error) {
    return handleGuessSongError(error, 'admin.questions.delete')
  }
}
