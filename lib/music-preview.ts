import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getFfmpegPath } from '@/lib/guess-song-audio'

export const MUSIC_PREVIEW_DURATION = 7
export const MUSIC_AUDIO_MAX_FILE_SIZE = 100 * 1024 * 1024
export const MUSIC_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
])

export class MusicPreviewProcessingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MusicPreviewProcessingError'
  }
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(getFfmpegPath(), args, { windowsHide: true })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new MusicPreviewProcessingError('音频处理超时，请稍后重试'))
    }, 120_000)
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.once('error', () => {
      clearTimeout(timer)
      reject(new MusicPreviewProcessingError('FFmpeg 不可用，请检查服务器音频处理配置'))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new MusicPreviewProcessingError(`无法生成试听片段：${stderr.slice(-240)}`))
    })
  })
}

export async function createMusicPreview(input: Buffer, extension: string) {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'ecfc-music-preview-'))
  const safeExtension = extension.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'audio'
  const inputPath = path.join(tempDirectory, `source.${safeExtension}`)
  const outputPath = path.join(tempDirectory, 'preview.mp3')
  try {
    await writeFile(inputPath, input)
    await runFfmpeg([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-t',
      String(MUSIC_PREVIEW_DURATION),
      '-vn',
      '-ar',
      '44100',
      '-b:a',
      '128k',
      '-codec:a',
      'libmp3lame',
      outputPath,
    ])
    return await readFile(outputPath)
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}
