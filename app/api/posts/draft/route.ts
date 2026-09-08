import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getConfiguredForumBoardBySelectionId } from '@/lib/boards'
import { getCurrentUser } from '@/lib/auth'
import { hasTooManyContentImages, MAX_CONTENT_IMAGES, parseContentImageUrls } from '@/lib/content-images'
import {
  normalizeServerPostDraft,
  parsePostDraftPayload,
  type PostDraftPayload,
  type ServerPostDraft,
} from '@/lib/post-draft'
import { prisma } from '@/lib/prisma'
import { MAX_POST_PLAIN_TEXT_LENGTH, validateRichPostContent } from '@/lib/rich-text'
import { enforceApiRateLimit, sanitizeText, unauthenticatedResponse } from '@/lib/security'
import { hasAdminPermission } from '@/lib/admin-permissions'

export const dynamic = 'force-dynamic'

const MAX_DRAFT_REQUEST_BYTES = 512 * 1024
const noStoreHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
}

type DraftRow = {
  id: string
  userId: string
  boardId: string | null
  title: string
  content: string
  richContent: unknown
  imageUrls: unknown
  pendingSticker: unknown
  version: number
  createdAt: Date
  updatedAt: Date
}

type DraftInputResult =
  | { ok: true; value: PostDraftPayload }
  | { ok: false; errors: Record<string, string>; message: string }

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status, headers: noStoreHeaders })
}

function serializeDraft(row: DraftRow): ServerPostDraft {
  const draft = normalizeServerPostDraft({
    id: row.id,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    boardId: row.boardId,
    title: row.title,
    content: row.content,
    richContent: row.richContent,
    imageUrls: row.imageUrls,
    pendingSticker: row.pendingSticker,
  })
  if (!draft) throw new Error('Stored post draft is invalid')
  return draft
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseExpectedVersion(body: Record<string, unknown>) {
  if (body.expectedVersion === undefined || body.expectedVersion === null) return null
  if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) return undefined
  return Number(body.expectedVersion)
}

function parseDraftInput(body: Record<string, unknown>): DraftInputResult {
  const richCandidate = body.richContent
  let richContent: PostDraftPayload['richContent'] = null
  let richPlainText = ''
  if (richCandidate !== undefined && richCandidate !== null) {
    const richResult = validateRichPostContent(richCandidate)
    if (!richResult.valid) {
      return { ok: false, message: '富文本草稿格式无效', errors: { richContent: richResult.errors[0] || '富文本格式无效' } }
    }
    richContent = richResult.value
    richPlainText = richResult.plainText
  }

  if (body.imageUrls !== undefined && !Array.isArray(body.imageUrls)) {
    return { ok: false, message: '图片草稿格式无效', errors: { imageUrls: '图片列表格式无效' } }
  }
  if (hasTooManyContentImages(body.imageUrls)) {
    return {
      ok: false,
      message: `图片数量不能超过 ${MAX_CONTENT_IMAGES} 张图片`,
      errors: { imageUrls: `最多保存 ${MAX_CONTENT_IMAGES} 张图片` },
    }
  }

  const parsed = parsePostDraftPayload({
    boardId: typeof body.boardId === 'string' ? body.boardId : '',
    title: body.title,
    content: body.content,
    richContent,
    imageUrls: body.imageUrls,
    pendingSticker: body.pendingSticker,
  })
  if (!parsed) return { ok: false, message: '草稿格式无效', errors: { form: '草稿格式无效' } }

  if (body.pendingSticker !== undefined && body.pendingSticker !== null && !parsed.pendingSticker) {
    return { ok: false, message: '表情草稿格式无效', errors: { pendingSticker: '表情引用格式无效' } }
  }

  const content = richContent ? richPlainText : sanitizeText(body.content, MAX_POST_PLAIN_TEXT_LENGTH)

  return {
    ok: true,
    value: {
      ...parsed,
      title: sanitizeText(body.title, 120),
      content,
      richContent,
      imageUrls: parseContentImageUrls(body.imageUrls),
    },
  }
}

async function validateBoardSelection(boardId: string, user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  if (!boardId) return null
  const configuredBoard = getConfiguredForumBoardBySelectionId(boardId)
  if (configuredBoard) {
    if (configuredBoard.slug === 'announcements' && !await hasAdminPermission(user, 'post_manage')) return 'FORBIDDEN'
    return boardId
  }

  const board = await prisma.board.findFirst({
    where: {
      id: boardId,
      isActive: true,
      ...(await hasAdminPermission(user, 'post_manage') ? {} : { slug: { not: 'announcements' } }),
    },
    select: { id: true },
  })
  return board?.id || null
}

function draftWriteData(value: PostDraftPayload) {
  return {
    boardId: value.boardId || null,
    title: value.title,
    content: value.content,
    richContent: value.richContent ? value.richContent as Prisma.InputJsonValue : Prisma.DbNull,
    imageUrls: value.imageUrls as Prisma.InputJsonValue,
    pendingSticker: value.pendingSticker ? value.pendingSticker as Prisma.InputJsonValue : Prisma.DbNull,
  }
}

async function currentUserOr401() {
  const user = await getCurrentUser()
  return user ? { user } : { response: unauthenticatedResponse() }
}

export async function GET(request: Request) {
  const auth = await currentUserOr401()
  if ('response' in auth) return auth.response
  const limited = await enforceApiRateLimit(request, auth.user.id, {
    endpoint: '/api/posts/draft:read',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited

  const row = await prisma.postDraft.findUnique({ where: { userId: auth.user.id } })
  return json({ ok: true, draft: row ? serializeDraft(row) : null })
}

export async function PUT(request: Request) {
  const auth = await currentUserOr401()
  if ('response' in auth) return auth.response
  const limited = await enforceApiRateLimit(request, auth.user.id, {
    endpoint: '/api/posts/draft:write',
    ip: { limit: 180, windowSeconds: 60 },
    user: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, message: '请求格式无效' }, 400)
  }
  if (!isJsonObject(body)) return json({ ok: false, message: '请求格式无效' }, 400)
  try {
    if (JSON.stringify(body).length > MAX_DRAFT_REQUEST_BYTES) return json({ ok: false, message: '草稿内容过大' }, 413)
  } catch {
    return json({ ok: false, message: '草稿格式无效' }, 400)
  }

  const expectedVersion = parseExpectedVersion(body)
  if (expectedVersion === undefined) return json({ ok: false, message: '草稿版本无效', errors: { expectedVersion: '版本号无效' } }, 400)
  const input = parseDraftInput(body)
  if (!input.ok) return json({ ok: false, message: input.message, errors: input.errors }, 400)

  const boardSelection = await validateBoardSelection(input.value.boardId, auth.user)
  if (boardSelection === 'FORBIDDEN') return json({ ok: false, message: '当前账号不能保存公告区草稿', errors: { boardId: '无权选择公告区' } }, 403)
  if (input.value.boardId && !boardSelection) return json({ ok: false, message: '板块不存在或已下架', errors: { boardId: '请选择有效板块' } }, 400)

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.postDraft.findUnique({ where: { userId: auth.user.id } })
      if (current) {
        if (expectedVersion === null || expectedVersion !== current.version) {
          return { kind: 'conflict' as const, draft: current }
        }
        const updated = await tx.postDraft.updateMany({
          where: { id: current.id, userId: auth.user.id, version: expectedVersion },
          data: { ...draftWriteData(input.value), version: { increment: 1 } },
        })
        if (updated.count !== 1) {
          return {
            kind: 'conflict' as const,
            draft: await tx.postDraft.findUnique({ where: { userId: auth.user.id } }),
          }
        }
        return {
          kind: 'saved' as const,
          draft: await tx.postDraft.findUnique({ where: { userId: auth.user.id } }),
        }
      }

      if (expectedVersion !== null && expectedVersion !== 0) return { kind: 'conflict' as const, draft: null }
      return {
        kind: 'saved' as const,
        draft: await tx.postDraft.create({
          data: {
            userId: auth.user.id,
            ...draftWriteData(input.value),
          },
        }),
      }
    })

    if (result.kind === 'conflict') {
      return json({
        ok: false,
        code: 'DRAFT_CONFLICT',
        message: '这份草稿已在另一台设备更新。',
        draft: result.draft ? serializeDraft(result.draft) : null,
      }, 409)
    }
    if (!result.draft) return json({ ok: false, message: '草稿保存失败，请稍后重试' }, 500)
    return json({ ok: true, draft: serializeDraft(result.draft) })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const latest = await prisma.postDraft.findUnique({ where: { userId: auth.user.id } })
      return json({
        ok: false,
        code: 'DRAFT_CONFLICT',
        message: '这份草稿已在另一台设备更新。',
        draft: latest ? serializeDraft(latest) : null,
      }, 409)
    }
    console.error('[posts.draft.save]', { name: error instanceof Error ? error.name : 'unknown' })
    return json({ ok: false, message: '草稿暂时无法同步，请稍后重试' }, 500)
  }
}

export const PATCH = PUT

export async function DELETE(request: Request) {
  const auth = await currentUserOr401()
  if ('response' in auth) return auth.response
  const limited = await enforceApiRateLimit(request, auth.user.id, {
    endpoint: '/api/posts/draft:delete',
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited
  await prisma.postDraft.deleteMany({ where: { userId: auth.user.id } })
  return json({ ok: true })
}
