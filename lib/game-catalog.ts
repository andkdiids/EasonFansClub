export type GameCategory = '音乐' | '知识' | '挑战' | '休闲' | '多人'

export type GameCatalogItem = {
  slug: string
  title: string
  eyebrow: string
  description: string
  longDescription: string
  categories: GameCategory[]
  difficulty: string
  players: string
  plays: string
  tags: string[]
  available: boolean
  featured: boolean
  isNew?: boolean
  accent: 'blue' | 'green' | 'violet' | 'amber'
  coverLabel: string
  rules: string[]
  rewards: string[]
  updates: string[]
}

export const gameCategories = ['全部', '音乐', '知识', '挑战', '休闲', '多人', '热门', '最新'] as const
export type GameCategoryFilter = typeof gameCategories[number]

export const gameCatalog: GameCatalogItem[] = [
  {
    slug: 'guess-song',
    title: 'E声猜歌',
    eyebrow: 'LISTEN & GUESS',
    description: '听一小段旋律，在有限播放次数内找出正确歌曲。',
    longDescription: '从熟悉的旋律切入，在不同音频长度与播放次数限制下挑战你的 Eason 歌曲记忆。',
    categories: ['音乐', '挑战'],
    difficulty: '四档难度',
    players: '单人',
    plays: '持续开放',
    tags: ['热门', '音乐', '挑战'],
    available: true,
    featured: true,
    accent: 'green',
    coverLabel: 'PLAY THE TAPE',
    rules: ['每题先手动播放音频，再从候选歌曲中作答。', '不同模式拥有不同片段长度与最大播放次数。', '答题结果由服务端结算，完成一局后写入既有排行榜。'],
    rewards: ['当前版本沿用现有积分和经验规则。', '游戏成绩、连击与播放次数继续按原规则计算。'],
    updates: ['全新沉浸式磁带播放器', '答对后自动进入下一题', '移动端安全区域与底部答题区优化'],
  },
  {
    slug: 'daily-prescription',
    title: '每日处方',
    eyebrow: 'DAILY PRESCRIPTION',
    description: '每天领取一次属于你的歌词处方与挂号费惊喜。',
    longDescription: '每日零点按北京时间刷新。领取结果仍完全沿用娱乐中心原有服务端规则。',
    categories: ['休闲'],
    difficulty: '轻松',
    players: '单人',
    plays: '每日一次',
    tags: ['每日', '休闲'],
    available: true,
    featured: true,
    accent: 'blue',
    coverLabel: 'ONE A DAY',
    rules: ['每天只能领取一次。', '歌词和奖励结果由现有服务端逻辑决定。'],
    rewards: ['沿用现有每日处方挂号费奖励与每日上限规则。'],
    updates: ['加入统一游戏大厅入口'],
  },
  {
    slug: 'lyrics-chain',
    title: '歌词接龙',
    eyebrow: 'LYRICS CHAIN',
    description: '沿着上一句歌词，接出下一段熟悉旋律。',
    longDescription: '多人歌词接龙玩法正在准备中。',
    categories: ['音乐', '多人'],
    difficulty: '待公布',
    players: '多人',
    plays: '即将开放',
    tags: ['音乐', '多人'],
    available: false,
    featured: true,
    accent: 'violet',
    coverLabel: 'COMING SOON',
    rules: ['玩法仍在设计中。'],
    rewards: ['开放后公布。'],
    updates: ['概念预览'],
  },
  {
    slug: 'concert-knowledge',
    title: '演唱会知识',
    eyebrow: 'CONCERT QUIZ',
    description: '从舞台、曲目与经典现场中检验你的记忆。',
    longDescription: '演唱会知识挑战正在准备中。',
    categories: ['知识', '挑战'],
    difficulty: '待公布',
    players: '单人',
    plays: '即将开放',
    tags: ['知识', '挑战'],
    available: false,
    featured: true,
    accent: 'amber',
    coverLabel: 'COMING SOON',
    rules: ['玩法仍在设计中。'],
    rewards: ['开放后公布。'],
    updates: ['概念预览'],
  },
]

export function findGame(slug: string) {
  return gameCatalog.find((game) => game.slug === slug)
}
