import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import type { LivePhotoConfig } from '@/lib/live-photo-config'
import { getLivePhotoConfig } from '@/lib/live-photo-config-store'
import { prisma } from '@/lib/prisma'
import { readPrivateLivePhotoObject, uploadPrivateLivePhotoObject } from '@/lib/live-photo-storage'

const queue: string[] = []
const running = new Set<string>()
let draining = false

export function activeLivePhotoAssetIds() {
  return new Set([...running, ...queue])
}

export function getFfmpegExecutable() {
  return process.env.FFMPEG_PATH?.trim() || ffmpegInstaller.path
}

async function runFfmpeg(args: string[], timeoutMs: number, assetId: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(getFfmpegExecutable(), args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('LIVE_PHOTO_TRANSCODE_TIMEOUT'))
    }, timeoutMs)
    child.stderr?.on('data', (chunk: Buffer) => {
      // Keep only the tail for a bounded error code; never log media content.
      stderr = (stderr + chunk.toString()).slice(-800)
    })
    child.once('error', () => {
      clearTimeout(timer)
      reject(new Error('LIVE_PHOTO_FFMPEG_UNAVAILABLE'))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(stderr.includes('Invalid') ? 'LIVE_PHOTO_INVALID_MEDIA' : 'LIVE_PHOTO_TRANSCODE_FAILED'))
    })
    void assetId
  })
}

async function transcodeAsset(assetId: string, config: LivePhotoConfig) {
  const asset = await prisma.livePhotoAsset.findUnique({ where: { id: assetId } })
  if (!asset || asset.status === 'CANCELLED' || asset.status === 'READY') return
  const directory = await mkdtemp(path.join(tmpdir(), 'ecfc-live-photo-'))
  try {
    await prisma.livePhotoAsset.update({
      where: { id: assetId },
      data: { status: 'PROCESSING', stage: 'read-originals', errorCode: null, errorMessage: null },
    })

    const [coverSource, videoSource] = await Promise.all([
      readPrivateLivePhotoObject({ key: asset.sourceCoverKey, range: null }),
      readPrivateLivePhotoObject({ key: asset.sourceVideoKey, range: null }),
    ])
    const coverMeta = await sharp(coverSource.body).metadata()
    const cover = await sharp(coverSource.body)
      .rotate()
      .resize({ width: config.maxVideoEdge, height: config.maxVideoEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer()
    const thumbnail = await sharp(coverSource.body)
      .rotate()
      .resize({ width: 360, height: 360, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer()

    await prisma.livePhotoAsset.update({
      where: { id: assetId },
      data: {
        stage: 'transcode',
        widthSource: coverMeta.width ?? null,
        heightSource: coverMeta.height ?? null,
      },
    })

    const inputPath = path.join(directory, `source.${asset.sourceVideoKey.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4'}`)
    const outputPath = path.join(directory, 'live.mp4')
    await writeFile(inputPath, videoSource.body)
    const scale = `scale='min(${config.maxVideoEdge},iw)':-2`
    const commonArgs = [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath,
      '-map', '0:v:0', ...(config.keepAudio ? ['-map', '0:a?'] : ['-an']),
      '-t', String(config.maxDurationSeconds), '-vf', scale, '-r', String(config.maxFps),
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    ]
    let video: Buffer | undefined
    for (const crf of [config.quality, Math.min(40, config.quality + 6)]) {
      await runFfmpeg([...commonArgs, '-crf', String(crf), ...(config.keepAudio ? ['-c:a', 'aac', '-b:a', '96k'] : []), '-movflags', '+faststart', '-map_metadata', '-1', outputPath], config.transcodeTimeoutMs, assetId)
      const candidate = await readFile(outputPath)
      video = candidate
      if (candidate.byteLength <= config.maxAssetBytes) break
    }
    if (!video) throw new Error('LIVE_PHOTO_TRANSCODE_EMPTY')
    if (video.byteLength > config.maxAssetBytes) throw new Error('LIVE_PHOTO_TOO_LARGE')

    await prisma.livePhotoAsset.update({ where: { id: assetId }, data: { stage: 'upload-results' } })
    const prefix = asset.sourceCoverKey.replace(/\/source-cover$/, '')
    const [coverKey, thumbnailKey, videoKey] = await Promise.all([
      uploadPrivateLivePhotoObject({ key: `${prefix}/cover.webp`, body: cover, contentType: 'image/webp' }),
      uploadPrivateLivePhotoObject({ key: `${prefix}/thumb.webp`, body: thumbnail, contentType: 'image/webp' }),
      uploadPrivateLivePhotoObject({ key: `${prefix}/video.mp4`, body: video, contentType: 'video/mp4' }),
    ])

    await prisma.livePhotoAsset.update({
      where: { id: assetId },
      data: {
        status: 'READY',
        stage: 'done',
        coverKey,
        thumbnailKey,
        videoKey,
        size: video.byteLength,
        coverSize: cover.byteLength + thumbnail.byteLength,
        width: coverMeta.width ?? null,
        height: coverMeta.height ?? null,
        videoCodec: 'h264',
        audioCodec: config.keepAudio && asset.hasAudio ? 'aac' : null,
        hasAudio: config.keepAudio && asset.hasAudio,
        processedAt: new Date(),
      },
    })
  } catch (error) {
    const latest = await prisma.livePhotoAsset.findUnique({ where: { id: assetId }, select: { status: true } }).catch(() => null)
    if (latest?.status === 'CANCELLED') return
    const code = error instanceof Error && /^LIVE_PHOTO_[A-Z_]+$/.test(error.message) ? error.message : 'LIVE_PHOTO_TRANSCODE_FAILED'
    await prisma.livePhotoAsset.update({
      where: { id: assetId },
      data: { status: 'FAILED', stage: 'failed', errorCode: code, errorMessage: code.slice(0, 120) },
    }).catch(() => undefined)
    console.warn('[live-photo.transcode]', { assetId, code })
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function drain() {
  if (draining) return
  draining = true
  try {
    const config = await getLivePhotoConfig()
    while (queue.length) {
      while (running.size >= config.transcodeConcurrency) {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      const assetId = queue.shift()
      if (!assetId || running.has(assetId)) continue
      running.add(assetId)
      void transcodeAsset(assetId, config).finally(() => {
        running.delete(assetId)
        void drain()
      })
    }
  } finally {
    draining = false
  }
}

/** Idempotent enqueue. One asset produces at most one active transcode. */
export function enqueueLivePhotoTranscode(assetId: string) {
  if (running.has(assetId) || queue.includes(assetId)) return
  queue.push(assetId)
  void drain()
}

/** Called lazily on the first live-photo API request after a process restart. */
export async function recoverUnfinishedLivePhotos() {
  const staleBefore = new Date(Date.now() - 5 * 60_000)
  await prisma.livePhotoAsset.updateMany({
    where: { status: 'PROCESSING', updatedAt: { lt: staleBefore } },
    data: { status: 'PENDING', stage: 'recovered', errorCode: null },
  })
  const pending = await prisma.livePhotoAsset.findMany({ where: { status: 'PENDING' }, select: { id: true } })
  pending.forEach(({ id }) => enqueueLivePhotoTranscode(id))
  return pending.length
}
