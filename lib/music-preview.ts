import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getFfmpegPath } from '@/lib/guess-song-audio'
import {
  MUSIC_AUDIO_MAX_FILE_SIZE,
  MUSIC_AUDIO_TYPES,
} from '@/lib/music-upload-constraints'

export const EASMUSIC_PREVIEW_MAX_SECONDS = 60
export const MUSIC_PREVIEW_DURATION = EASMUSIC_PREVIEW_MAX_SECONDS
export { MUSIC_AUDIO_MAX_FILE_SIZE, MUSIC_AUDIO_TYPES }

export class MusicPreviewProcessingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MusicPreviewProcessingError'
  }
}

function runFfmpeg(args: string[]) {
  return new Promise<{ stderr: string }>((resolve, reject) => {
    const child = spawn(getFfmpegPath(), args, { windowsHide: true })
    let stderr = ''
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => reject(new MusicPreviewProcessingError('音频处理超时，请稍后重试')))
    }, 120_000)
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.once('error', () => {
      finish(() => reject(new MusicPreviewProcessingError('FFmpeg 不可用，请检查服务器音频处理配置')))
    })
    child.once('close', (code) => {
      finish(() => {
        if (code === 0) resolve({ stderr })
        else reject(new MusicPreviewProcessingError(`无法生成试听片段：${stderr.slice(-240)}`))
      })
    })
  })
}

function parseDurationMs(stderr: string) {
  const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/)
  if (!match) return null
  return Math.round(
    (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000,
  )
}

export async function createMusicSourceAndPreview(input: Buffer, extension: string) {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'ecfc-music-preview-'))
  const safeExtension = extension.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'audio'
  const inputPath = path.join(tempDirectory, `source.${safeExtension}`)
  const sourcePath = path.join(tempDirectory, 'source.mp3')
  const outputPath = path.join(tempDirectory, 'preview.mp3')
  try {
    await writeFile(inputPath, input)
    const probe = await runFfmpeg([
      '-hide_banner',
      '-i',
      inputPath,
      '-f',
      'null',
      '-',
    ])
    const durationMs = parseDurationMs(probe.stderr)
    if (!durationMs) {
      throw new MusicPreviewProcessingError('无法读取音频时长，请确认文件未损坏')
    }
    await runFfmpeg([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-vn',
      '-ar',
      '44100',
      '-b:a',
      '128k',
      '-codec:a',
      'libmp3lame',
      sourcePath,
    ])
    await runFfmpeg([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      '0',
      '-i',
      inputPath,
      '-t',
      String(EASMUSIC_PREVIEW_MAX_SECONDS),
      '-vn',
      '-ar',
      '44100',
      '-b:a',
      '128k',
      '-codec:a',
      'libmp3lame',
      outputPath,
    ])
    return {
      source: await readFile(sourcePath),
      preview: await readFile(outputPath),
      durationMs,
      previewDuration: Math.max(
        1,
        Math.min(EASMUSIC_PREVIEW_MAX_SECONDS, Math.ceil(durationMs / 1000)),
      ),
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

export async function createMusicPreview(input: Buffer, extension: string) {
  return (await createMusicSourceAndPreview(input, extension)).preview
}
