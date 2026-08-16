import { MAX_DAILY_PRESCRIPTION_REWARD, MIN_DAILY_PRESCRIPTION_REWARD } from '@/lib/daily-prescription-reward'

export type GameCategory = '音乐' | '挑战' | '休闲' | '多人'

export type GameCatalogItem = {
  slug: string
  title: string
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
  rules: string[]
  rewards: string[]
}

export const gameCategories = ['全部', '音乐', '挑战', '休闲', '多人', '热门', '最新'] as const
export type GameCategoryFilter = typeof gameCategories[number]

export const gameCatalog: GameCatalogItem[] = [
  {
    slug: 'guess-song',
    title: '听听',
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
    rules: ['简单、进阶、困难使用选择题，专家需要输入歌曲名称。', '每题最多播放 5 次；普通模式累计 3 次错误、专家累计 5 次错误后结束。', '答题结果由服务端结算，完成挑战后写入对应排行榜。'],
    rewards: ['当前版本沿用现有积分和经验规则。', '游戏成绩、连击与播放次数继续按原规则计算。'],
  },
  {
    slug: 'daily-prescription',
    title: '每日处方',
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
    rules: ['每天只能领取一次，按北京时间自然日判断。', `每日随机获得 ${MIN_DAILY_PRESCRIPTION_REWARD}～${MAX_DAILY_PRESCRIPTION_REWARD} 挂号费，数值越高越稀有。`],
    rewards: [`挂号费奖励范围固定为 ${MIN_DAILY_PRESCRIPTION_REWARD}～${MAX_DAILY_PRESCRIPTION_REWARD}，同一天刷新不会重新抽取。`],
  },
  {
    slug: 'want-listen',
    title: '想听',
    description: '不用播放，也知道是哪一首。',
    longDescription: '没有声音，你还认得出这些歌吗？从发行资料、专辑、创作信息和歌词线索中，逐步找回陈奕迅的歌曲。',
    categories: ['音乐', '挑战'],
    difficulty: '三种玩法',
    players: '单人',
    plays: '持续开放',
    tags: ['音乐', '挑战', '最新'],
    available: true,
    featured: true,
    isNew: true,
    accent: 'amber',
    rules: ['每局 20 题，服务端创建并保存对局进度。', '想听模式最多四层提示，使用越少，答对得分越高。', '粤语残片和防不胜防每题答对 100 分，成绩会写入独立排行榜。'],
    rewards: ['三个模式独立统计今日、本周和总榜。', '完成对局会更新个人统计与想听成就，不发放挂号费。'],
  },
  {
    slug: 'undercover-star',
    title: '卧底巨星',
    description: '谁说得最像真的，谁就最可疑。',
    longDescription: '3～4 人实时房间推理游戏。平民拿到相同词语，卧底拿到相近但不同的词语，在描述与投票中找出真正的卧底。',
    categories: ['音乐', '多人'],
    difficulty: '3～4 人',
    players: '3～4 人',
    plays: '实时房间',
    tags: ['多人', '推理', '最新'],
    available: true,
    featured: true,
    isNew: true,
    accent: 'violet',
    rules: ['每局只有 1 名卧底，身份和词语只由服务端私密返回。', '依次描述、投票淘汰；平票进入加赛，卧底被投出后还有一次猜词翻盘机会。', '房间状态、倒计时、淘汰与胜负全部由服务端结算。'],
    rewards: ['记录游戏胜负、个人统计与卧底巨星成就，不发放挂号费。'],
  },
  {
    slug: 'lyrics-chain',
    title: '歌词接龙',
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
    rules: ['玩法仍在设计中。'],
    rewards: ['开放后公布。'],
  },
  {
    slug: 'concert-knowledge',
    title: '演唱会知识',
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
    rules: ['玩法仍在设计中。'],
    rewards: ['开放后公布。'],
  },
]

export function findGame(slug: string) {
  return gameCatalog.find((game) => game.slug === slug)
}
