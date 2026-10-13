import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { CantoneseAudioAssetStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  FoundationAudioUnavailable,
  createFoundationAudioStorage,
  foundationAudioObjectKey,
  readFoundationAudioConfig,
  synthesizeFoundationAudio,
} from '@/lib/cantonese-foundation-audio'
import { publicAudioAsset } from '@/lib/cantonese-content-admin'
import { nextCantoneseAudioVersion, safeReviewIdentifier } from '@/lib/cantonese-review'
import { resolveAudioPronunciation } from '@/lib/cantonese-audio-pronunciation'
import { requireRequestAdmin } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
type RouteContext = { params: Promise<{ audioId: string }> }

function error(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status, headers: NO_STORE })
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') return error('FORBIDDEN', '只有管理员可以生成粤语音频', 403)
  const rawId = (await context.params).audioId
  const audioId = safeReviewIdentifier(rawId)
  if (!audioId) return error('INVALID_AUDIO_ID', '音频 ID 无效', 400)

  const asset = await prisma.cantoneseAudioAsset.findUnique({ where: { externalId: audioId } })
  if (!asset) return error('AUDIO_NOT_FOUND', '音频资源不存在', 404)
  const pronunciation = await resolveAudioPronunciation(prisma, asset)
  if (!pronunciation.validSource) return error('AUDIO_CONTENT_MISMATCH', '音频的来源教学内容不匹配', 409)
  if (!pronunciation.text || !pronunciation.jyutping || !pronunciation.verified) {
    return error('JYUTPING_REVIEW_REQUIRED', '请先核对粤拼，再生成标准音频', 409)
  }
  // The reviewed Content is canonical; the resolver validates its exact review digest.
  const current = { ...asset, text: pronunciation.text, jyutping: pronunciation.jyutping }
  const audioVersion = pronunciation.snapshotMatches ? current.audioVersion : nextCantoneseAudioVersion(current.audioVersion)
  const staleGenerationBefore = new Date(Date.now() - 10 * 60 * 1000)
  if (current.assetStatus === 'GENERATING' && current.updatedAt >= staleGenerationBefore) {
    return error('AUDIO_GENERATION_IN_PROGRESS', '音频正在生成，请稍后查看', 409)
  }

  let config: ReturnType<typeof readFoundationAudioConfig>
  try {
    config = readFoundationAudioConfig()
  } catch (cause) {
    if (cause instanceof FoundationAudioUnavailable && cause.code === 'CONFIG') return error('AUDIO_CONFIG_MISSING', '音频服务配置不完整', 503)
    return error('AUDIO_CONFIG_INVALID', '音频服务配置无效', 503)
  }

  const voiceType = Number(current.voiceProfile || config.voiceType)
  const speed = current.speed ?? config.speed
  const sampleRate = current.sampleRate || config.sampleRate
  const codec = (current.codec || config.codec).toLowerCase()
  if (voiceType !== 101019 || !Number.isFinite(speed) || speed < -2 || speed > 6
    || ![8000, 16000].includes(sampleRate) || codec !== 'mp3') {
    return error('AUDIO_SETTINGS_UNSUPPORTED', '当前粤语音频参数不受支持', 400)
  }
  const runtimeConfig = { ...config, voiceType, speed, sampleRate, codec: 'mp3' as const }
  const cosKey = foundationAudioObjectKey(current.text, runtimeConfig)
  // The client-facing audioKey is opaque; never expose the COS object path.
  const audioKey = createHash('sha256').update(cosKey).digest('hex')

  const owner = await prisma.cantoneseAudioAsset.findUnique({ where: { audioKey } })
  if (owner && owner.externalId !== audioId) {
    if (owner.assetStatus !== 'READY' || !owner.cosKey || !owner.checksum || !owner.fileSize) {
      return error('AUDIO_GENERATION_IN_PROGRESS', '相同音频正在生成，请稍后再试', 409)
    }
    try {
      const storage = createFoundationAudioStorage(config)
      if (!await storage.exists(owner.cosKey)) return error('AUDIO_ASSET_MISSING', '已有音频文件不可用，请先重新生成', 409)
      const latestSource = await resolveAudioPronunciation(prisma, asset)
      if (!latestSource.verified || latestSource.digest !== pronunciation.digest) return error('JYUTPING_REVIEW_REQUIRED', '来源粤拼已变化，请重新核对', 409)
      const reused = await prisma.cantoneseAudioAsset.update({
        where: { externalId: audioId },
        data: { text: current.text, jyutping: current.jyutping, audioVersion, audioKey: null, cosKey: owner.cosKey, checksum: owner.checksum, fileSize: owner.fileSize,
          assetStatus: 'READY', status: 'CONTENT_REVIEW_REQUIRED', reviewedById: null, reviewedAt: null, reviewNote: null },
      })
      return NextResponse.json({ item: publicAudioAsset(reused), audioUrl: storage.signedUrl(owner.cosKey),
        expiresInSeconds: 300, reused: true, reviewStatus: 'CONTENT_REVIEW_REQUIRED' }, { headers: NO_STORE })
    } catch {
      return error('AUDIO_PREVIEW_UNAVAILABLE', '音频试听地址暂时不可用', 503)
    }
  }

  const claimable: Prisma.CantoneseAudioAssetWhereInput = current.assetStatus === 'GENERATING'
    ? { assetStatus: 'GENERATING' as const, updatedAt: { lt: staleGenerationBefore } }
    : !pronunciation.snapshotMatches
      ? { updatedAt: asset.updatedAt }
    : { assetStatus: { in: ['NOT_GENERATED', 'FAILED', 'NEEDS_REGENERATION'] as CantoneseAudioAssetStatus[] } }
  let claim: { count: number }
  try {
    claim = await prisma.cantoneseAudioAsset.updateMany({
      where: { externalId: audioId, updatedAt: asset.updatedAt, ...claimable },
      data: { text: current.text, jyutping: current.jyutping, audioVersion, assetStatus: 'GENERATING', audioKey, cosKey: null, checksum: null, fileSize: null,
        status: 'CONTENT_REVIEW_REQUIRED', reviewedById: null, reviewedAt: null, reviewNote: null },
    })
  } catch (cause) {
    // A concurrent request for another asset claimed the same unique audioKey.
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'P2002') {
      return error('AUDIO_GENERATION_IN_PROGRESS', '相同音频正在生成，请稍后再试', 409)
    }
    throw cause
  }
  if (claim.count === 0) {
    const latest = await prisma.cantoneseAudioAsset.findUnique({ where: { externalId: audioId } })
    const latestSource = latest ? await resolveAudioPronunciation(prisma, latest) : null
    if (latest?.assetStatus === 'READY' && latest.cosKey && latestSource?.verified && latestSource.snapshotMatches && latestSource.digest === pronunciation.digest) {
      try {
        const storage = createFoundationAudioStorage(config)
        return NextResponse.json({ item: publicAudioAsset(latest), audioUrl: storage.signedUrl(latest.cosKey), expiresInSeconds: 300, reused: true }, { headers: NO_STORE })
      } catch {
        return error('AUDIO_PREVIEW_UNAVAILABLE', '音频试听地址暂时不可用', 503)
      }
    }
    return error('AUDIO_GENERATION_IN_PROGRESS', '音频正在生成，请稍后查看', 409)
  }

  const storage = createFoundationAudioStorage(config)
  try {
    const exists = await storage.exists(cosKey)
    let fileSize: number | null = null
    let checksum: string | null = null
    if (exists) {
      fileSize = storage.metadata ? (await storage.metadata(cosKey)).fileSize : null
      if (!fileSize || fileSize > 3_000_000 || !storage.read) throw new FoundationAudioUnavailable('COS')
      const cachedAudio = await storage.read(cosKey)
      const hasId3 = cachedAudio.subarray(0, 3).toString('ascii') === 'ID3'
      const hasFrameSync = cachedAudio.length >= 2 && cachedAudio[0] === 0xff && (cachedAudio[1] & 0xe0) === 0xe0
      if (cachedAudio.length !== fileSize || (!hasId3 && !hasFrameSync)) throw new FoundationAudioUnavailable('COS')
      checksum = createHash('sha256').update(cachedAudio).digest('hex')
    } else {
      const audio = await synthesizeFoundationAudio(current.text, runtimeConfig)
      checksum = createHash('sha256').update(audio).digest('hex')
      fileSize = audio.length
      await storage.upload(cosKey, audio)
    }
    const latestPronunciation = await resolveAudioPronunciation(prisma, asset)
    if (!latestPronunciation.verified || latestPronunciation.digest !== pronunciation.digest) {
      throw new Error('SOURCE_CHANGED')
    }
    const updated = await prisma.cantoneseAudioAsset.update({
      where: { externalId: audioId },
      data: { audioKey, cosKey, checksum, fileSize, assetStatus: 'READY', status: 'CONTENT_REVIEW_REQUIRED' },
    })
    return NextResponse.json({
      item: publicAudioAsset(updated),
      audioUrl: storage.signedUrl(cosKey),
      expiresInSeconds: 300,
      reused: exists,
      reviewStatus: 'CONTENT_REVIEW_REQUIRED',
    }, { headers: NO_STORE })
  } catch (cause) {
    await prisma.cantoneseAudioAsset.updateMany({ where: { externalId: audioId, assetStatus: 'GENERATING' }, data: { assetStatus: 'FAILED', audioKey: null } }).catch(() => {})
    if (cause instanceof Error && cause.message === 'SOURCE_CHANGED') return error('JYUTPING_REVIEW_REQUIRED', '来源粤拼已变化，请重新核对', 409)
    const code = cause instanceof FoundationAudioUnavailable ? cause.code : 'UNKNOWN'
    console.warn('[cantonese.audio.generate]', { audioId, code })
    return error(code === 'CONFIG' ? 'AUDIO_CONFIG_MISSING' : 'AUDIO_GENERATION_FAILED', '音频生成失败，请稍后重试', 503)
  }
}
