import { sanitizeText } from '@/lib/security'

export const LYRIC_PRESCRIPTION_MAX_LENGTH = 80
export const LYRIC_SONG_TITLE_MAX_LENGTH = 160
export const LYRIC_ALBUM_TITLE_MAX_LENGTH = 160

export type LyricPrescriptionInput =
  | { ok: true; data: { text: string; songTitle: string; albumTitle: string | null; enabled: boolean } }
  | { ok: false; error: string }

export function parseLyricPrescriptionInput(value: unknown): LyricPrescriptionInput {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const text = sanitizeText(body.text, LYRIC_PRESCRIPTION_MAX_LENGTH)
  const songTitle = sanitizeText(body.songTitle, LYRIC_SONG_TITLE_MAX_LENGTH)
  const albumTitle = sanitizeText(body.albumTitle, LYRIC_ALBUM_TITLE_MAX_LENGTH) || null

  if (!text) return { ok: false, error: '歌词短句不能为空或仅包含空格' }
  if (!songTitle) return { ok: false, error: '歌曲名称不能为空或仅包含空格' }

  return {
    ok: true,
    data: {
      text,
      songTitle,
      albumTitle,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    },
  }
}
