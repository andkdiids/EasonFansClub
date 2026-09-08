import { COMMUNITY_REWARD_LIMITS, COMMUNITY_REWARD_POINTS } from '@/lib/community-rewards'
import { MIN_DAILY_PRESCRIPTION_REWARD, MAX_DAILY_PRESCRIPTION_REWARD } from '@/lib/daily-prescription-reward'
import { LONG_TERM_PATIENT_DAILY_BONUS, LONG_TERM_PATIENT_STREAK_DAYS } from '@/lib/registration-fee'
import { POINTS } from '@/lib/points'
import { DUEL_WIN_REWARD } from '@/lib/guess-song-duel-config'

/**
 * The growth system is intentionally a registry, not a second front-end
 * task hierarchy.  Product copy and economy limits live here so APIs, UI and
 * tests all consume the same source of truth.
 */

export const TASK_SYSTEM_LAUNCH_DATE_KEY = '2026-09-08'
export const TASK_SYSTEM_GRACE_DATE_KEY = '2026-09-07'
// The grace date is the Monday key of its one affected Shanghai week. Keeping
// it explicit makes the exception impossible to repeat on a future Monday.
export const TASK_SYSTEM_GRACE_WEEK_KEY = TASK_SYSTEM_GRACE_DATE_KEY
export const TASK_SYSTEM_LAUNCH_AT = new Date(`${TASK_SYSTEM_LAUNCH_DATE_KEY}T00:00:00+08:00`)

export type GrowthTaskCode =
  | 'DAILY_CHECKIN'
  | 'DAILY_PRESCRIPTION'
  | 'DAILY_GAME'
  | 'DAILY_COMMENT'
  | 'POST_LIKE_ACTIVE'
  | 'CONTENT_SHARE_ACTIVE'
  | 'PUBLISH_POST_ACTIVE'
  | 'POST_COMMENT_RECEIVED'
  | 'LISTEN_DUEL_BRANCH'
  | 'POST_LIKED'
  | 'POST_COLLECTED'
  | 'COMMENT_LIKED'
  | 'SALON_APPROVED'
  | 'SALON_LIKED'
  | 'SONG_REVIEW_CREATED'
  | 'SONG_REVIEW_LIKED'
  | 'BEAD_PUBLISHED'
  | 'BEAD_LIKED'
  | 'PROFILE_COMPLETE'
  | 'FIRST_POST'
  | 'FIRST_COMMENT'
  | 'FIRST_RECEIVED_COMMENT'
  | 'FIRST_FRIEND'
  | 'FIRST_WALL_MESSAGE'
  | 'FIRST_EASMUSIC_RATING'
  | 'COMPLETE_TOP27'
  | 'COMPLETE_TOP10_ALBUM'
  | 'FIRST_SALON'
  | 'FIRST_BEAD_PROJECT'
  | 'FIRST_ACTIVITY_REGISTRATION'
  | 'FIRST_ACTIVITY_ATTENDANCE'
  | 'FIRST_BADGE'
  | 'FIRST_BADGE_EQUIP'
  | 'FIRST_CONCERT_SEEN'

export type GrowthTaskKind = 'active' | 'passive' | 'newLife'
export type GrowthTaskSurface = 'core' | 'action'
export type GrowthFrequency = 'daily' | 'weekly' | 'once'
export type GrowthClaimMode = 'none' | 'manual'

export type GrowthTaskDefinition = {
  code: GrowthTaskCode
  title: string
  description: string
  kind: GrowthTaskKind
  surface?: GrowthTaskSurface
  frequency: GrowthFrequency
  reward: number
  dailyCap?: number
  weeklyCap?: number
  capUnit?: 'points' | 'events'
  eligibleFrom: Date
  completionMode: 'event' | 'currentState'
  claimMode: GrowthClaimMode
  existingReward?: string
  displayReward?: string
  actionHref?: string
  completionThreshold?: number
}

export type GrowthRewardRule = {
  code: string
  title: string
  amount: number | null
  amountLabel: string
  dailyCap?: number
  weeklyCap?: number
  maxDailyAmount?: number
  maxWeeklyAmount?: number
  capUnit?: 'points' | 'events'
  unit?: '次' | '篇' | '天'
  detail?: string
  milestoneDays?: number
  claimable?: boolean
  claimed?: boolean
}

export type GrowthRewardRuleGroup = {
  key: 'daily' | 'active' | 'passive' | 'weekly'
  title: string
  items: GrowthRewardRule[]
}

const launch = TASK_SYSTEM_LAUNCH_AT
const historical = new Date('1970-01-01T00:00:00.000Z')

export const GROWTH_TASKS: readonly GrowthTaskDefinition[] = [
  { code: 'DAILY_CHECKIN', title: '每日挂号', description: '完成今天的挂号', kind: 'active', surface: 'core', frequency: 'daily', reward: 0, eligibleFrom: launch, completionMode: 'event', claimMode: 'none', existingReward: '沿用每日挂号现有奖励', displayReward: '+14', actionHref: '/checkin' },
  { code: 'DAILY_PRESCRIPTION', title: '每日处方', description: '领取今天的娱乐处方', kind: 'active', surface: 'core', frequency: 'daily', reward: 0, eligibleFrom: launch, completionMode: 'event', claimMode: 'none', existingReward: '沿用每日处方现有奖励', displayReward: '+7～+27', actionHref: '/games/daily-prescription' },
  { code: 'DAILY_GAME', title: '完成一局游戏', description: '完成今天的一局娱乐游戏', kind: 'active', surface: 'core', frequency: 'daily', reward: 0, dailyCap: 1, capUnit: 'events', completionThreshold: 1, eligibleFrom: launch, completionMode: 'event', claimMode: 'none', existingReward: '沿用游戏现有奖励', actionHref: '/games' },
  { code: 'DAILY_COMMENT', title: '回复帖子', description: '在今天参与一次有效讨论', kind: 'active', surface: 'core', frequency: 'daily', reward: COMMUNITY_REWARD_POINTS.commentPost, dailyCap: COMMUNITY_REWARD_LIMITS.commentPostDaily, capUnit: 'events', completionThreshold: 1, eligibleFrom: launch, completionMode: 'event', claimMode: 'none', existingReward: '沿用回复现有奖励', actionHref: '/forum' },

  { code: 'POST_LIKE_ACTIVE', title: '帖子点赞', description: '给其他用户的帖子点赞', kind: 'active', surface: 'action', frequency: 'daily', reward: 1, dailyCap: 5, capUnit: 'events', eligibleFrom: launch, completionMode: 'event', claimMode: 'none', actionHref: '/forum' },
  { code: 'CONTENT_SHARE_ACTIVE', title: '分享内容', description: '完成一次站内分享', kind: 'active', surface: 'action', frequency: 'daily', reward: 2, dailyCap: 1, capUnit: 'events', eligibleFrom: launch, completionMode: 'event', claimMode: 'none', actionHref: '/forum' },
  { code: 'PUBLISH_POST_ACTIVE', title: '发布帖子', description: '发布一篇符合站内公开规则的帖子', kind: 'active', surface: 'action', frequency: 'daily', reward: 2, dailyCap: 1, weeklyCap: 7, capUnit: 'events', eligibleFrom: launch, completionMode: 'event', claimMode: 'none', actionHref: '/posts/new' },

  { code: 'POST_LIKED', title: '帖子被点赞', description: '帖子每获得一位有效用户点赞 +1', kind: 'passive', frequency: 'daily', reward: 1, dailyCap: 5, capUnit: 'points', eligibleFrom: launch, completionMode: 'event', claimMode: 'none' },
  { code: 'POST_COLLECTED', title: '帖子被收藏', description: '帖子每被收藏一次 +2，本周最多 10', kind: 'passive', frequency: 'weekly', reward: 2, weeklyCap: 10, capUnit: 'points', eligibleFrom: launch, completionMode: 'event', claimMode: 'none' },
  { code: 'POST_COMMENT_RECEIVED', title: '帖子被回复', description: '自己的帖子收到有效回复，每次 +2，每日最多计 5 次', kind: 'passive', frequency: 'daily', reward: COMMUNITY_REWARD_POINTS.postCommentReceived, dailyCap: COMMUNITY_REWARD_LIMITS.postCommentReceivedDaily, capUnit: 'events', eligibleFrom: launch, completionMode: 'event', claimMode: 'none' },
  { code: 'COMMENT_LIKED', title: '回复被点赞', description: '回复每获得一位有效用户点赞 +1', kind: 'passive', frequency: 'daily', reward: 1, dailyCap: 5, capUnit: 'points', eligibleFrom: launch, completionMode: 'event', claimMode: 'none' },
  { code: 'SALON_APPROVED', title: '沙龙作品通过审核', description: '每篇通过审核的沙龙作品 +7，本周最多 2 篇', kind: 'passive', frequency: 'weekly', reward: 7, weeklyCap: 2, capUnit: 'events', eligibleFrom: launch, completionMode: 'event', claimMode: 'none' },
  { code: 'SALON_LIKED', title: '沙龙作品被点赞', description: '作品每获得一位有效用户点赞 +1', kind: 'passive', frequency: 'daily', reward: 1, dailyCap: 5, capUnit: 'points', eligibleFrom: launch, completionMode: 'event', claimMode: 'none' },
  { code: 'SONG_REVIEW_CREATED', title: '发表歌曲评价', description: '每发表一条有效歌曲评价 +5，本周最多 3 条', kind: 'passive', frequency: 'weekly', reward: 5, weeklyCap: 3, capUnit: 'events', eligibleFrom: launch, completionMode: 'event', claimMode: 'none' },
  { code: 'SONG_REVIEW_LIKED', title: '歌曲评价被点赞', description: '评价每获得一位有效用户点赞 +1', kind: 'passive', frequency: 'daily', reward: 1, dailyCap: 5, capUnit: 'points', eligibleFrom: launch, completionMode: 'event', claimMode: 'none' },
  { code: 'BEAD_PUBLISHED', title: '贝多芬与我作品通过审核', description: '每篇公开作品通过审核 +7，本周最多 2 篇', kind: 'passive', frequency: 'weekly', reward: 7, weeklyCap: 2, capUnit: 'events', eligibleFrom: launch, completionMode: 'event', claimMode: 'none' },
  { code: 'BEAD_LIKED', title: '贝多芬与我作品被喜欢', description: '作品每获得一位有效用户喜欢或收藏 +1', kind: 'passive', frequency: 'daily', reward: 1, dailyCap: 5, capUnit: 'points', eligibleFrom: launch, completionMode: 'event', claimMode: 'none' },
  { code: 'LISTEN_DUEL_BRANCH', title: '听听 1v1 对决', description: '完成一场有效的听听 1v1 对决', kind: 'passive', frequency: 'weekly', reward: 0, capUnit: 'events', completionThreshold: 1, eligibleFrom: launch, completionMode: 'event', claimMode: 'none', actionHref: '/games/guess-song/duel' },

  { code: 'PROFILE_COMPLETE', title: '完善个人资料', description: '补齐头像、昵称、简介、性别、地区和生日', kind: 'newLife', frequency: 'once', reward: 27, eligibleFrom: historical, completionMode: 'currentState', claimMode: 'manual', actionHref: '/profile?edit=1' },
  { code: 'FIRST_POST', title: '发表第一篇帖子', description: '第一篇新发布且审核通过的帖子', kind: 'newLife', frequency: 'once', reward: 10, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual', actionHref: '/posts/new' },
  { code: 'FIRST_COMMENT', title: '第一次回复他人', description: '第一次对其他用户的帖子发表有效回复', kind: 'newLife', frequency: 'once', reward: 5, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual', actionHref: '/forum' },
  { code: 'FIRST_RECEIVED_COMMENT', title: '第一次收到回复', description: '自己的帖子第一次收到其他用户的有效回复', kind: 'newLife', frequency: 'once', reward: 5, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual' },
  { code: 'FIRST_FRIEND', title: '成为第一位好友', description: '第一次成功建立好友关系', kind: 'newLife', frequency: 'once', reward: 5, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual', actionHref: '/friends' },
  { code: 'FIRST_WALL_MESSAGE', title: '第一次留言', description: '第一次在其他用户的留言墙留下有效内容', kind: 'newLife', frequency: 'once', reward: 10, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual', actionHref: '/friends' },
  { code: 'FIRST_EASMUSIC_RATING', title: '第一次使用 EasMusic 评分', description: '第一次完成歌曲或专辑评分', kind: 'newLife', frequency: 'once', reward: 10, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual', actionHref: '/ratings' },
  { code: 'COMPLETE_TOP27', title: '完成 Top 27', description: '个人歌曲榜单填满 27 首', kind: 'newLife', frequency: 'once', reward: 27, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual', actionHref: '/ratings?view=personal&type=songs' },
  { code: 'COMPLETE_TOP10_ALBUM', title: '完成 Top 10 专辑', description: '个人专辑榜单填满 10 张', kind: 'newLife', frequency: 'once', reward: 10, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual', actionHref: '/ratings?view=personal&type=albums' },
  { code: 'FIRST_SALON', title: '第一次投稿沙龙', description: '第一篇沙龙作品审核通过', kind: 'newLife', frequency: 'once', reward: 10, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual', actionHref: '/salon/upload' },
  { code: 'FIRST_BEAD_PROJECT', title: '第一次保存贝多芬与我作品', description: '第一次成功云端存档作品', kind: 'newLife', frequency: 'once', reward: 10, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual', actionHref: '/studio/beads' },
  { code: 'FIRST_ACTIVITY_REGISTRATION', title: '第一次报名活动', description: '第一次成功报名活动', kind: 'newLife', frequency: 'once', reward: 10, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual', actionHref: '/activities' },
  { code: 'FIRST_ACTIVITY_ATTENDANCE', title: '第一次参加活动', description: '第一次由人工或二维码完成现场核销', kind: 'newLife', frequency: 'once', reward: 27, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual' },
  { code: 'FIRST_BADGE', title: '获得第一枚非初始勋章', description: '获得一枚非系统初始勋章', kind: 'newLife', frequency: 'once', reward: 10, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual', actionHref: '/badges' },
  { code: 'FIRST_BADGE_EQUIP', title: '第一次佩戴勋章', description: '第一次成功佩戴勋章', kind: 'newLife', frequency: 'once', reward: 5, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual', actionHref: '/badges' },
  { code: 'FIRST_CONCERT_SEEN', title: '第一次记录看过的演唱会', description: '第一次保存演唱会观看记录', kind: 'newLife', frequency: 'once', reward: 27, eligibleFrom: launch, completionMode: 'event', claimMode: 'manual', actionHref: '/music/live/me' },
]

export const WEEKLY_MILESTONES = [
  { days: 3, reward: 27 },
  { days: 5, reward: 50 },
  { days: 7, reward: 74 },
] as const

const taskMap = new Map(GROWTH_TASKS.map((task) => [task.code, task]))

export function getGrowthTask(code: GrowthTaskCode) {
  return taskMap.get(code) || null
}

/**
 * Every task surface uses this registry-owned destination. A null result is
 * deliberate for passive or externally verified tasks without a meaningful
 * user action to start.
 */
export function resolveGrowthTaskDestination(code: GrowthTaskCode) {
  return taskMap.get(code)?.actionHref || null
}

export function getTasksByKind(kind: GrowthTaskKind) {
  return GROWTH_TASKS.filter((task) => task.kind === kind)
}

export function getTasksBySurface(surface: GrowthTaskSurface) {
  return GROWTH_TASKS.filter((task) => task.surface === surface)
}

export function getCoreActiveTasks() {
  return GROWTH_TASKS.filter((task) => task.kind === 'active' && task.surface === 'core')
}

export function getActiveActionTasks() {
  return GROWTH_TASKS.filter((task) => task.kind === 'active' && task.surface === 'action')
}

type RewardRuleOverrides = {
  amount: number | null
  amountLabel: string
  dailyCap?: number
  weeklyCap?: number
  maxDailyAmount?: number
  maxWeeklyAmount?: number
  capUnit?: 'points' | 'events'
  unit?: '次' | '篇' | '天'
  detail?: string
}

function makeRewardRule(task: GrowthTaskDefinition, overrides: RewardRuleOverrides): GrowthRewardRule {
  const dailyCap = overrides.dailyCap ?? task.dailyCap
  const weeklyCap = overrides.weeklyCap ?? task.weeklyCap
  const maxDailyAmount = overrides.maxDailyAmount ?? (dailyCap === undefined || overrides.amount === null ? undefined : overrides.amount * dailyCap)
  const maxWeeklyAmount = overrides.maxWeeklyAmount ?? (weeklyCap === undefined || overrides.amount === null ? undefined : overrides.amount * weeklyCap)
  return {
    code: task.code,
    title: task.title,
    amount: overrides.amount,
    amountLabel: overrides.amountLabel,
    dailyCap,
    weeklyCap,
    maxDailyAmount,
    maxWeeklyAmount,
    capUnit: overrides.capUnit ?? task.capUnit,
    unit: overrides.unit,
    detail: overrides.detail,
  }
}

function getDailyRewardRules() {
  return getCoreActiveTasks().map((task) => {
    if (task.code === 'DAILY_CHECKIN') {
      return makeRewardRule(task, {
        amount: null,
        amountLabel: '按现有规则结算',
        detail: `基础 ${POINTS.dailyCheckInMin}～${POINTS.dailyCheckInMax}；连续挂号满 ${LONG_TERM_PATIENT_STREAK_DAYS} 天另有 +${LONG_TERM_PATIENT_DAILY_BONUS}`,
      })
    }
    if (task.code === 'DAILY_PRESCRIPTION') {
      return makeRewardRule(task, {
        amount: null,
        amountLabel: `+${MIN_DAILY_PRESCRIPTION_REWARD}～+${MAX_DAILY_PRESCRIPTION_REWARD}`,
        detail: '按每日处方现有规则随机结算，同一天只领取一次',
      })
    }
    if (task.code === 'DAILY_GAME') {
      return makeRewardRule(task, {
        amount: null,
        amountLabel: '沿用对应游戏现有奖励',
      })
    }
    return makeRewardRule(task, {
      amount: COMMUNITY_REWARD_POINTS.commentPost,
      amountLabel: `+${COMMUNITY_REWARD_POINTS.commentPost} / 次`,
      dailyCap: COMMUNITY_REWARD_LIMITS.commentPostDaily,
      capUnit: 'events',
      unit: '次',
      detail: '沿用有效回复他人帖子的现有奖励',
    })
  })
}

function getActiveRewardRules() {
  return getActiveActionTasks().map((task) => {
    if (task.code === 'POST_LIKE_ACTIVE') {
      return makeRewardRule(task, {
        amount: task.reward,
        amountLabel: `+${task.reward} / 次`,
        unit: '次',
        detail: '自己的帖子不计入；同一帖子取消后重赞不重复计入',
      })
    }
    if (task.code === 'CONTENT_SHARE_ACTIVE') {
      return makeRewardRule(task, {
        amount: task.reward,
        amountLabel: `+${task.reward}`,
        unit: '次',
        detail: '每天首次有效使用站内分享',
      })
    }
    return makeRewardRule(task, {
      amount: task.reward,
      amountLabel: `+${task.reward} / 篇`,
      unit: '篇',
      detail: '普通用户需审核通过后计入；审核豁免用户直接公开即计入',
    })
  })
}

function getPassiveRewardRules() {
  return getTasksByKind('passive').map((task) => {
    if (task.code === 'POST_COMMENT_RECEIVED') {
      return makeRewardRule(task, {
        amount: COMMUNITY_REWARD_POINTS.postCommentReceived,
        amountLabel: `+${COMMUNITY_REWARD_POINTS.postCommentReceived} / 次`,
        dailyCap: COMMUNITY_REWARD_LIMITS.postCommentReceivedDaily,
        capUnit: 'events',
        unit: '次',
        maxDailyAmount: COMMUNITY_REWARD_POINTS.postCommentReceived * COMMUNITY_REWARD_LIMITS.postCommentReceivedDaily,
        detail: '沿用帖子作者收到有效回复的现有奖励',
      })
    }
    if (task.code === 'LISTEN_DUEL_BRANCH') {
      return makeRewardRule(task, {
        amount: DUEL_WIN_REWARD,
        amountLabel: `+${DUEL_WIN_REWARD} / 胜`,
        detail: '完成记录仅用于支线进度，不新增另一份奖励',
      })
    }
    const unit = task.code === 'SALON_APPROVED' || task.code === 'BEAD_PUBLISHED' ? '篇' : '次'
    return makeRewardRule(task, {
      amount: task.reward,
      amountLabel: `+${task.reward} / ${unit}`,
      unit,
      detail: task.frequency === 'daily' ? '按当天有效互动计算' : '按本周有效记录计算',
    })
  })
}

/**
 * User-facing reward copy is generated from the same task registry and the
 * existing feature reward constants. The New Life item rewards are purposely
 * not included here; they are a separate surface with its own 16-item total.
 */
export function getRewardRuleGroups(): GrowthRewardRuleGroup[] {
  return [
    { key: 'daily', title: '每日任务', items: getDailyRewardRules() },
    { key: 'active', title: '主动任务', items: getActiveRewardRules() },
    { key: 'passive', title: '支线', items: getPassiveRewardRules() },
    {
      key: 'weekly',
      title: '本周奖励',
      items: WEEKLY_MILESTONES.map((milestone) => ({
        code: `WEEKLY_MILESTONE_${milestone.days}`,
        title: `完成 ${milestone.days} 天`,
        amount: milestone.reward,
        amountLabel: `+${milestone.reward}`,
        unit: '天' as const,
        milestoneDays: milestone.days,
      })),
    },
  ]
}

export function getEconomyReport() {
  const passive = getTasksByKind('passive')
  const maxPassiveDaily = passive
    .filter((task) => task.dailyCap)
    .reduce((total, task) => total + task.reward * (task.dailyCap || 0), 0)
  const maxPassiveWeekly = passive
    .filter((task) => task.weeklyCap)
    .reduce((total, task) => total + task.reward * (task.weeklyCap || 0), 0)
  const newLifeTotal = getTasksByKind('newLife').reduce((total, task) => total + task.reward, 0)
  const milestoneTotal = WEEKLY_MILESTONES.reduce((total, milestone) => total + milestone.reward, 0)
  return {
    maxPassiveDaily,
    maxPassiveWeekly: maxPassiveDaily * 7 + maxPassiveWeekly,
    newLifeTotal,
    weeklyMilestoneTotal: milestoneTotal,
    weeklyMilestones: WEEKLY_MILESTONES,
  }
}
