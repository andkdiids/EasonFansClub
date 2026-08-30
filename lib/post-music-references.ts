import {
  collectMusicReferenceSongIds,
  enrichMusicReferenceMetadata,
  extractPlainText,
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

  constructor(readonly songIds: string[]) {
    super('帖子包含不存在或未公开的 EasMusic 歌曲引用')
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
