export const MUSIC_AUDIO_MAX_FILE_SIZE = 100 * 1024 * 1024
export const MUSIC_COVER_MAX_FILE_SIZE = 10 * 1024 * 1024

export const MUSIC_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/vnd.wave',
  'audio/aac',
  'audio/x-aac',
])

export const MUSIC_AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'aac'])
export const MUSIC_COVER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const MUSIC_COVER_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])

function extensionOf(fileName: string) {
  const extension = fileName.trim().toLowerCase().split('.').pop()
  return extension && extension !== fileName.toLowerCase() ? extension : ''
}

export function isSupportedMusicAudioFile(file: Pick<File, 'name' | 'type'>) {
  return MUSIC_AUDIO_TYPES.has(file.type.toLowerCase()) || MUSIC_AUDIO_EXTENSIONS.has(extensionOf(file.name))
}

export function isSupportedMusicCoverFile(file: Pick<File, 'name' | 'type'>) {
  return MUSIC_COVER_TYPES.has(file.type.toLowerCase()) || MUSIC_COVER_EXTENSIONS.has(extensionOf(file.name))
}

export function detectMusicAudioType(buffer: Buffer) {
  if (buffer.length < 12) return null
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3'
    || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return 'mp3'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return 'wav'
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'm4a'
  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return 'aac'
  return null
}
