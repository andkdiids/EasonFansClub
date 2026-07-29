import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  isSupportedMusicAudioFile,
  isSupportedMusicCoverFile,
  MUSIC_AUDIO_MAX_FILE_SIZE,
  MUSIC_COVER_MAX_FILE_SIZE,
} from '../lib/music-upload-constraints'
import { createMusicPreview } from '../lib/music-preview'

const read = (path: string) => readFileSync(path, 'utf8')
const previewUploader = read('app/admin/music/MusicPreviewUploader.tsx')
const coverUploader = read('app/admin/music/MusicCoverUploader.tsx')
const previewRoute = read('app/api/admin/music/songs/[songId]/preview/route.ts')
const coverRoute = read('app/api/admin/music/covers/route.ts')
const previewProcessor = read('lib/music-preview.ts')
const coverProcessor = read('lib/music-cover.ts')
const storage = read('lib/music-media-storage.ts')
const uploadClient = read('app/admin/music/music-upload-client.ts')
const nextConfig = read('next.config.ts')

function createTestWave(seconds: number) {
  const sampleRate = 8_000
  const sampleCount = sampleRate * seconds
  const dataSize = sampleCount * 2
  const wave = Buffer.alloc(44 + dataSize)
  wave.write('RIFF', 0)
  wave.writeUInt32LE(36 + dataSize, 4)
  wave.write('WAVEfmt ', 8)
  wave.writeUInt32LE(16, 16)
  wave.writeUInt16LE(1, 20)
  wave.writeUInt16LE(1, 22)
  wave.writeUInt32LE(sampleRate, 24)
  wave.writeUInt32LE(sampleRate * 2, 28)
  wave.writeUInt16LE(2, 32)
  wave.writeUInt16LE(16, 34)
  wave.write('data', 36)
  wave.writeUInt32LE(dataSize, 40)
  for (let index = 0; index < sampleCount; index += 1) {
    wave.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 6_000), 44 + index * 2)
  }
  return wave
}

test('音频和封面格式与大小限制在前后端复用', () => {
  assert.equal(MUSIC_AUDIO_MAX_FILE_SIZE, 100 * 1024 * 1024)
  assert.equal(MUSIC_COVER_MAX_FILE_SIZE, 10 * 1024 * 1024)
  for (const name of ['sample.mp3', 'sample.m4a', 'sample.wav', 'sample.aac']) {
    assert.equal(isSupportedMusicAudioFile({ name, type: '' }), true)
  }
  for (const [name, type] of [['cover.jpg', 'image/jpeg'], ['cover.png', 'image/png'], ['cover.webp', 'image/webp']]) {
    assert.equal(isSupportedMusicCoverFile({ name, type }), true)
  }
  assert.match(previewUploader, /MUSIC_AUDIO_MAX_FILE_SIZE/)
  assert.match(previewRoute, /MUSIC_AUDIO_MAX_FILE_SIZE/)
  assert.match(coverUploader, /MUSIC_COVER_MAX_FILE_SIZE/)
  assert.match(coverRoute, /MUSIC_COVER_MAX_FILE_SIZE/)
})

test('上传界面展示完整阶段且失败不清除已选文件', () => {
  for (const source of [previewUploader, coverUploader]) {
    assert.match(source, /setStage\('processing'\)/)
    assert.match(source, /setStage\('uploading'\)/)
    assert.match(source, /setStage\('converting'\)/)
    assert.match(source, /setStage\('complete'\)/)
    assert.match(source, /setStage\('error'\)/)
    assert.match(source, /readMusicUploadResponse/)
    assert.match(source, /console\.error/)
  }
  assert.match(uploadClient, /typeof data\.error === 'string'/)
  assert.match(uploadClient, /MUSIC_UPLOAD_TIMEOUT_MS = 190_000/)
})

test('API 异常始终返回带 error 的 JSON 并记录上传上下文', () => {
  for (const source of [previewRoute, coverRoute]) {
    assert.match(source, /catch \(error\) \{[\s\S]*\.unhandled\]/)
    assert.match(source, /NextResponse\.json\(\{ success: false, code, error: message, message \}/)
    assert.match(source, /fileName: file\.name/)
    assert.match(source, /mimeType: file\.type/)
    assert.match(source, /fileSize: file\.size/)
    assert.match(source, /export const maxDuration = 180/)
  }
})

test('FFmpeg 只生成前 7 秒 128kbps MP3 并清理完整源文件', () => {
  assert.match(previewProcessor, /'-ss',\s*'0'/)
  assert.match(previewProcessor, /'-t',\s*String\(MUSIC_PREVIEW_DURATION\)/)
  assert.match(previewProcessor, /'128k'/)
  assert.match(previewProcessor, /'libmp3lame'/)
  assert.match(previewProcessor, /finally \{[\s\S]*rm\(tempDirectory, \{ recursive: true, force: true \}\)/)
  assert.match(previewRoute, /music-preview\/\$\{song\.albumId\}\/\$\{song\.id\}\/preview\.mp3/)
  assert.match(previewRoute, /sourceStored: false/)
})

test('FFmpeg 可将 8 秒 WAV 实际转换为非空 MP3 试听文件', async () => {
  const preview = await createMusicPreview(createTestWave(8), 'wav')
  assert.ok(preview.byteLength > 10_000)
  assert.ok(preview.subarray(0, 3).toString() === 'ID3' || (preview[0] === 0xff && (preview[1] & 0xe0) === 0xe0))
})

test('Sharp 与 COS 上传具有生产约束和超时保护', () => {
  assert.match(coverProcessor, /MUSIC_COVER_MAX_WIDTH = 2000/)
  assert.match(coverProcessor, /MUSIC_COVER_QUALITY = 82/)
  assert.match(coverProcessor, /\.webp\(\{ quality: MUSIC_COVER_QUALITY \}\)/)
  assert.match(storage, /COS_UPLOAD_TIMEOUT_MS = 120_000/)
  assert.match(storage, /Promise\.race/)
  assert.match(storage, /COS_UPLOAD_TIMEOUT/)
  assert.match(nextConfig, /'sharp'/)
})
