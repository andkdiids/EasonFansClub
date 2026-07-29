export const DAILY_MOODS = [
  { key: 'happy', icon: '😀', label: '开心', weight: 92 },
  { key: 'blessed', icon: '🥰', label: '很幸福', weight: 95 },
  { key: 'calm', icon: '😌', label: '平静', weight: 78 },
  { key: 'crying', icon: '😭', label: '想哭', weight: 38 },
  { key: 'tired', icon: '😴', label: '很累', weight: 46 },
  { key: 'annoyed', icon: '😤', label: '烦躁', weight: 35 },
  { key: 'sick', icon: '🤒', label: '生病中', weight: 30 },
  { key: 'missing', icon: '🥺', label: '想念Eason', weight: 72 },
  { key: 'looping', icon: '🎵', label: '今天循环陈奕迅', weight: 88 },
  { key: 'fulfilled', icon: '❤️', label: '今天很满足', weight: 96 },
]

export const DAILY_QUOTES = [
  '慢慢来，今天也有一首歌会替你说话。',
  '把心情挂个号，剩下的交给音乐。',
  '认真生活的人，总会和喜欢的旋律重逢。',
  '今天不用很厉害，能抵达这里就很好。',
  '如果想念有声音，那就让它循环播放。',
]

export const CHECK_IN_EXP = 5

export function getMood(key?: string | null) {
  return DAILY_MOODS.find((mood) => mood.key === key)
}

export function getDailyQuote(date = new Date()) {
  const dayIndex = Math.floor(date.getTime() / 86400000)
  return DAILY_QUOTES[dayIndex % DAILY_QUOTES.length]
}

export function calcMoodIndex(moods: { mood: string; _count: { mood: number } }[]) {
  const total = moods.reduce((sum, item) => sum + item._count.mood, 0)
  if (!total) return 0

  const score = moods.reduce((sum, item) => {
    const mood = getMood(item.mood)
    return sum + (mood?.weight || 60) * item._count.mood
  }, 0)

  return Math.round(score / total)
}

export function getStreakBonus(streak: number) {
  if (streak >= 7) return { points: 7, exp: 0, label: '长期患者奖励' }
  return null
}
