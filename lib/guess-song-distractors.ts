import { randomInt } from 'node:crypto'

export type DistractorSong = {
  id: string
  title: string
  albumId: string
  releaseYear: number
}

function normalizeTitle(title: string) {
  return title.trim().toLocaleLowerCase('zh-CN')
}

/**
 * 自动生成猜歌错误选项
 * 从所有歌曲库随机抽取3首不同歌曲
 */
export function pickGuessSongDistractors(
  correct: DistractorSong,
  pool: readonly DistractorSong[],
  count = 3,
) {
  const correctKey = normalizeTitle(correct.title)

  const candidates = pool.filter(
    (song) =>
      song.id !== correct.id &&
      normalizeTitle(song.title) !== correctKey,
  )

  const shuffled = [...candidates]

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)

    ;[shuffled[i], shuffled[j]] = [
      shuffled[j],
      shuffled[i],
    ]
  }

  return shuffled
    .slice(0, count)
    .map((song) => song.title)
}