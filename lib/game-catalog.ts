import { MAX_DAILY_PRESCRIPTION_REWARD, MIN_DAILY_PRESCRIPTION_REWARD } from '@/lib/daily-prescription-reward'

export type GameCategory = '音乐' | '挑战' | '休闲' | '多人'

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
}

export const gameCategories = ['全部', '音乐', '挑战', '休闲', '多人', '热门', '最新'] as const
export type GameCategoryFilter = typeof gameCategories[number]

export const gameCatalog: GameCatalogItem[] = [
  {
    slug: 'guess-song',
    title: '听听',
    eyebrow: 'LISTEN & GUESS',
    description: '听一小段旋律，在持续挑战中找出正确歌曲。',
    longDescription: '从熟悉的旋律切入，在不同音频长度与播放次数限制下持续挑战你的 Eason 歌曲记忆。',
    categories: ['音乐', '挑战'],
    difficulty: '四档难度',
    players: '单人',
    plays: '持续开放',
    tags: ['热门', '音乐', '挑战'],
    available: true,
    featured: true,
    accent: 'green',
    coverLabel: 'PLAY THE TAPE',
    rules: ['简单、进阶、困难使用选择题，专家需要输入歌曲名称。', '每题最多播放 5 次；普通模式累计 3 次错误、专家累计 5 次错误后结束。', '答题结果由服务端结算，完成挑战后写入对应排行榜。'],
    rewards: ['当前版本沿用现有积分和经验规则。', '游戏成绩、连击与播放次数继续按原规则计算。'],
  },
  {
    slug: 'daily-prescription',
    title: '每日处方',
    eyebrow: 'DAILY PRESCRIPTION',
    description: '每天领取一次属于你的歌词处方与挂号费惊喜。',
    longDescription: '每日零点按北京时间刷新。每位用户每天领取一次，奖励由服务端按递减权重随机决定。',
    categories: ['休闲'],
    difficulty: '轻松',
    players: '单人',
    plays: '每日一次',
    tags: ['每日', '休闲'],
    available: true,
    featured: true,
    accent: 'blue',
    coverLabel: 'ONE A DAY',
    rules: ['每天只能领取一次，按北京时间自然日判断。', `每日随机获得 ${MIN_DAILY_PRESCRIPTION_REWARD}～${MAX_DAILY_PRESCRIPTION_REWARD} 挂号费，数值越高越稀有。`],
    rewards: [`挂号费奖励范围固定为 ${MIN_DAILY_PRESCRIPTION_REWARD}～${MAX_DAILY_PRESCRIPTION_REWARD}，同一天刷新不会重新抽取。`],
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
  },
  {
    slug: 'concert-knowledge',
    title: '演唱会知识',
    eyebrow: 'CONCERT QUIZ',
    description: '从舞台、曲目与经典现场中检验你的记忆。',
    longDescription: '演唱会知识挑战正在准备中。',
    categories: ['挑战'],
    difficulty: '待公布',
    players: '单人',
    plays: '即将开放',
    tags: ['挑战'],
    available: false,
    featured: true,
    accent: 'amber',
    coverLabel: 'COMING SOON',
    rules: ['玩法仍在设计中。'],
    rewards: ['开放后公布。'],
  },
]

export function findGame(slug: string) {
  return gameCatalog.find((game) => game.slug === slug)
}
