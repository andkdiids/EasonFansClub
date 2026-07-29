import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GUESS_SONG_AUDIO_DURATIONS } from '@/lib/guess-song-config'

type GeneratedAudio = {
  durationMs: number
  source: Buffer
  variants: Array<{ durationSeconds: number; buffer: Buffer }>
}

export class GuessSongAudioProcessingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuessSongAudioProcessingError'
  }
}

export function getFfmpegPath() {
  return process.env.FFMPEG_PATH?.trim() || ffmpegInstaller.path
}

function runFfmpeg(args: string[], timeoutMs = 90_000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(getFfmpegPath(), args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new GuessSongAudioProcessingError('FFmpeg 处理超时'))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.once('error', () => {
      clearTimeout(timer)
      reject(new GuessSongAudioProcessingError('FFmpeg 不可用，请检查服务器音频处理配置'))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new GuessSongAudioProcessingError(`音频处理失败：${stderr.slice(-240)}`))
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

export async function processGuessSongAudio(input: Buffer, extension = 'audio') : Promise<GeneratedAudio> {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'ecfc-guess-song-'))
  const safeExtension = extension.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'audio'
  const inputPath = path.join(tempDirectory, `input.${safeExtension}`)
  const sourcePath = path.join(tempDirectory, 'source.mp3')

  try {
    await writeFile(inputPath, input)
    const probe = await runFfmpeg(['-hide_banner', '-i', inputPath, '-f', 'null', '-'])
      .catch((error: unknown) => {
        if (error instanceof GuessSongAudioProcessingError && error.message.includes('Duration:')) throw error
        throw error
      })
    const durationMs = parseDurationMs(probe.stderr)
    if (!durationMs) throw new GuessSongAudioProcessingError('无法读取音频时长，请确认文件未损坏')
    if (durationMs <= 0) throw new GuessSongAudioProcessingError('音频文件不包含可用音轨')

    await runFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath,
      '-vn', '-ar', '44100', '-b:a', '128k', '-codec:a', 'libmp3lame', sourcePath,
    ])

    const variants = []
    for (const durationSeconds of GUESS_SONG_AUDIO_DURATIONS) {
      const outputPath = path.join(tempDirectory, `${durationSeconds}.mp3`)
      await runFfmpeg([
        '-y', '-hide_banner', '-loglevel', 'error', '-i', sourcePath,
        '-t', String(durationSeconds), '-vn', '-ar', '44100', '-b:a', '128k',
        '-codec:a', 'libmp3lame', outputPath,
      ])
      variants.push({ durationSeconds, buffer: await readFile(outputPath) })
    }

    return {
      durationMs,
      source: await readFile(sourcePath),
      variants,
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}
