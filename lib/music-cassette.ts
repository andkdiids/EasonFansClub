import type { CassetteSong } from '@/types/music-cassette'

function hashSeed(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function randomFromSeed(seed: number) {
  let state = seed || 1
  return () => {
    state = Math.imul(1664525, state) + 1013904223 >>> 0
    return state / 4294967296
  }
}

export function createCassetteSeed() {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    return crypto.getRandomValues(new Uint32Array(1))[0]
  }
  return Date.now() >>> 0
}

function pickCassetteSongs(candidates: readonly CassetteSong[], count: number, initial: readonly CassetteSong[] = []) {
  const selected = [...initial]
  const deferred: CassetteSong[] = []
  for (const song of candidates) {
    if (selected.some((item) => item.id === song.id)) continue
    const lastAlbum = selected.at(-1)?.albumId
    if (lastAlbum && lastAlbum === song.albumId) deferred.push(song)
    else selected.push(song)
    if (selected.length === count) return selected
  }
  for (const song of deferred) {
    if (!selected.some((item) => item.id === song.id)) selected.push(song)
    if (selected.length === count) break
  }
  return selected
}

export function selectCassetteSongs(
  songs: readonly CassetteSong[],
  count: number,
  seed: number,
  excludedIds: ReadonlySet<string> = new Set(),
) {
  const random = randomFromSeed(seed)
  const shuffled = [...songs]
    .map((song) => ({ song, rank: random() + hashSeed(song.id) / 0xffffffff / 1000 }))
    .sort((left, right) => left.rank - right.rank)
    .map(({ song }) => song)
  const freshSongs = shuffled.filter((song) => !excludedIds.has(song.id))
  const fallbackSongs = shuffled.filter((song) => excludedIds.has(song.id))
  const selectedFreshSongs = pickCassetteSongs(freshSongs, count)
  if (selectedFreshSongs.length === count) return selectedFreshSongs
  return pickCassetteSongs(fallbackSongs, count, selectedFreshSongs)
}

export function cassetteLayoutFor(songId: string, index: number) {
  const hash = hashSeed(`${songId}:${index}`)
  return {
    rotate: (hash % 9) - 4,
    offsetX: ((hash >>> 4) % 13) - 6,
    offsetY: ((hash >>> 8) % 11) - 5,
  }
}
