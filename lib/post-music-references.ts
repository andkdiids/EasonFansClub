import {
  collectMusicReferenceSongIds,
  countMusicReferenceNodes,
  enrichMusicReferenceMetadata,
  extractPlainText,
  MAX_RICH_TEXT_MUSIC_REFERENCES,
  validateRichPostContent,
  type RichTextContent,
  type RichTextMusicReferenceMetadata,
} from '@/lib/rich-text'

export type PostMusicReferenceSong = {
  id: string
  title: string
  artist: string
  MusicAlbum: { name: string }
}

export class InvalidPostMusicReferenceError extends Error {
  readonly code = 'INVALID_MUSIC_REFERENCE'

  constructor(
    readonly songIds: string[],
    readonly reason: 'INVALID_SONG' | 'TOO_MANY' = 'INVALID_SONG',
  ) {
    super(reason === 'TOO_MANY' ? `每篇帖子最多引用 ${MAX_RICH_TEXT_MUSIC_REFERENCES} 首歌曲` : '帖子包含不存在或未公开的 EasMusic 歌曲引用')
    this.name = 'InvalidPostMusicReferenceError'
  }
}

/**
 * Validate every referenced song against the published MusicSong query owned
 * by the caller, then replace client-provided display text with the canonical
 * MusicSong snapshot. A post never persists a song reference that was not
 * returned by that server-side lookup.
 */
export async function validateAndNormalizePostMusicReferences(
  richContent: RichTextContent,
  findSongs: (songIds: string[]) => Promise<PostMusicReferenceSong[]>,
) {
  const songIds = collectMusicReferenceSongIds(richContent)
  if (countMusicReferenceNodes(richContent) > MAX_RICH_TEXT_MUSIC_REFERENCES) {
    throw new InvalidPostMusicReferenceError(songIds, 'TOO_MANY')
  }
  if (!songIds.length) {
    return { richContent, plainText: extractPlainText(richContent), songIds }
  }

  const songs = await findSongs(songIds)
  const songMap = new Map(songs.map((song) => [song.id, song]))
  const missingSongIds = songIds.filter((songId) => !songMap.has(songId))
  if (missingSongIds.length) throw new InvalidPostMusicReferenceError(missingSongIds)

  const metadata = new Map<string, RichTextMusicReferenceMetadata>(
    songs.map((song) => [song.id, {
      title: song.title,
      artist: song.artist,
      album: song.MusicAlbum.name,
    }]),
  )
  const enriched = enrichMusicReferenceMetadata(richContent, metadata)
  const validation = validateRichPostContent(enriched)
  if (!validation.valid) throw new InvalidPostMusicReferenceError(songIds)
  return { richContent: validation.value, plainText: validation.plainText, songIds }
}
