import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * `@ffmpeg-installer/ffmpeg` ships the ffmpeg binary only — there is no
 * ffprobe next to it. Media probing therefore never calls ffprobe: the pure
 * box parser handles MP4/MOV headers, and this decoder-based probe is the
 * fallback for containers the parser cannot read. It decodes one real frame,
 * so a positive answer also proves the clip is decodable on this server.
 */
export function getFfmpegExecutable() {
  return process.env.FFMPEG_PATH?.trim() || ffmpegInstaller.path
}

export type FfmpegAvailability = {
  available: boolean
  version: string | null
  /** `@ffmpeg-installer/ffmpeg` ships ffmpeg only; nothing calls ffprobe. */
  probeBinaryRequired: false
  decoders: string[]
}

export type FfmpegProbe = {
  width: number
  height: number
  durationMs: number
  hasAudio: boolean
}

/** Runtime fact for the admin panel: which media tool this process can run. */
export async function checkFfmpegAvailability(): Promise<FfmpegAvailability> {
  const result = await new Promise<{ code: number; stdout: string }>((resolve) => {
    const child = spawn(getFfmpegExecutable(), ['-hide_banner', '-version'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.stdout?.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(0, 4000) })
    child.once('error', () => {
      clearTimeout(timer)
      resolve({ code: -1, stdout: '' })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout })
    })
  })
  const version = result.stdout.match(/ffmpeg version (\S+)/)?.[1] ?? null
  return {
    available: result.code === 0 && Boolean(version),
    version,
    probeBinaryRequired: false,
    decoders: ['h264', 'hevc'],
  }
}

export type TranscodeArgsInput = {
  inputPath: string
  outputPath: string
  /** Longest edge of the output, applied to width and height alike. */
  maxVideoEdge: number
  maxFps: number
  maxDurationSeconds: number
  quality: number
  keepAudio: boolean
}

/**
 * The single source of truth for the transcode command. Portrait clips must be
 * capped on their long edge too, otherwise a 1080x1920 phone video keeps a
 * 1920px edge and blows past the size budget.
 */
export function buildTranscodeArgs(input: TranscodeArgsInput) {
  const edge = Math.max(2, Math.round(input.maxVideoEdge))
  const scale = `scale=w='if(gte(iw,ih),min(${edge}\\,iw),-2)':h='if(gte(iw,ih),-2,min(${edge}\\,ih))'`
  return [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', input.inputPath,
    '-map', '0:v:0', ...(input.keepAudio ? ['-map', '0:a?'] : ['-an']),
    '-t', String(input.maxDurationSeconds), '-vf', scale, '-r', String(input.maxFps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-crf', String(input.quality),
    ...(input.keepAudio ? ['-c:a', 'aac', '-b:a', '96k'] : []),
    // faststart keeps the moov box in front so playback can begin before the
    // whole file arrives; dropping metadata removes GPS and capture details.
    '-movflags', '+faststart', '-map_metadata', '-1', input.outputPath,
  ]
}

function parseDurationMs(stderr: string) {
  const match = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d{2})/)
  if (!match) return 0
  const [, hours, minutes, seconds, centis] = match
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(centis) * 10
}

/** `Stream #0:0(und): Video: h264 (High), yuv420p(pc), 1920x1080 [SAR 1:1], 30 fps` */
function parseVideoStream(stderr: string) {
  for (const line of stderr.split(/\r?\n/)) {
    if (!/:\s*Video:\s/.test(line)) continue
    const size = line.match(/(\d{2,5})x(\d{2,5})/)
    if (!size) continue
    return { width: Number(size[1]), height: Number(size[2]) }
  }
  return undefined
}

export async function probeVideoWithFfmpeg(bytes: Buffer, extension: 'mp4' | 'mov' = 'mp4', timeoutMs = 20_000): Promise<FfmpegProbe | null> {
  if (!bytes.byteLength) return null
  const directory = await mkdtemp(path.join(tmpdir(), 'ecfc-probe-'))
  const input = path.join(directory, `probe.${extension}`)
  try {
    await writeFile(input, bytes)
    const result = await new Promise<{ code: number; stderr: string }>((resolve) => {
      // `-frames:v 1 -f null -` forces a real decode of the first frame without
      // writing anything to disk. `-nostdin` keeps the child from blocking.
      const child = spawn(getFfmpegExecutable(), [
        '-hide_banner', '-nostdin', '-loglevel', 'info',
        '-i', input,
        '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-',
      ], { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
      child.stderr?.on('data', (chunk: Buffer) => {
        // Bounded tail: enough for the stream table, no media content.
        stderr = (stderr + chunk.toString()).slice(-8000)
      })
      child.once('error', () => {
        clearTimeout(timer)
        resolve({ code: -1, stderr: '' })
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        resolve({ code: code ?? -1, stderr })
      })
    })
    if (result.code !== 0) return null
    const video = parseVideoStream(result.stderr)
    if (!video) return null
    return {
      width: video.width,
      height: video.height,
      durationMs: parseDurationMs(result.stderr),
      hasAudio: /Stream #\d+:\d+.*:\s*Audio:\s/.test(result.stderr),
    }
  } catch {
    return null
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}
