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

export function selectCassetteSongs(songs: readonly CassetteSong[], count: number, seed: number) {
  const random = randomFromSeed(seed)
  const shuffled = [...songs]
    .map((song) => ({ song, rank: random() + hashSeed(song.id) / 0xffffffff / 1000 }))
    .sort((left, right) => left.rank - right.rank)
    .map(({ song }) => song)

  const selected: CassetteSong[] = []
  const deferred: CassetteSong[] = []
  for (const song of shuffled) {
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

export function cassetteLayoutFor(songId: string, index: number) {
  const hash = hashSeed(`${songId}:${index}`)
  return {
    rotate: (hash % 9) - 4,
    offsetX: ((hash >>> 4) % 13) - 6,
    offsetY: ((hash >>> 8) % 11) - 5,
  }
}
