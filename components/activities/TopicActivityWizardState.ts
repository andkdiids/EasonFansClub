import { parseActivityDateInput, type ActivityView } from '@/lib/activity'
import { createDefaultTopicActivityV2Program, type TopicActivityV2Program } from '@/lib/topic-activity-v2-config'
import { defaultTopicLotteryConfig, type TopicLotteryConfig } from '@/lib/topic-activity-v2-lottery-config'
import { createWizardId } from './TopicActivityWizardIds'

// UI-only draft. No persistence, requests, or new business model.
export type TopicActivityWizardDraft = {
  identity: { draftId: string; platformTaskIds: Record<string, string> }
  activity: Pick<ActivityView, 'type' | 'title' | 'description' | 'startsAt' | 'endsAt' | 'participationRule' | 'participationMode' | 'allowImageAttachments'>
  program: TopicActivityV2Program
  lottery: TopicLotteryConfig
}
export const topicWizardPlatforms = [
  { key: 'weibo', name: '微博' }, { key: 'xiaohongshu', name: '小红书' },
  { key: 'douyin', name: '抖音' }, { key: 'instagram', name: 'Instagram' },
  { key: 'bilibili', name: 'B 站' }, { key: 'wechat-channels', name: '视频号' },
] as const

export function createTopicWizardDraft(): TopicActivityWizardDraft {
  const program = createDefaultTopicActivityV2Program()
  program.poll.id = createWizardId('poll')
  program.test.id = createWizardId('test')
  program.enabled = true
  program.platformRewards.allowStacking = true
  return {
    identity: { draftId: createWizardId('draft'), platformTaskIds: Object.fromEntries(topicWizardPlatforms.map(({ key }) => [key, createWizardId('task')])) },
    activity: { type: 'TOPIC_ACTIVITY', title: '', description: '', startsAt: null, endsAt: null,
      participationRule: '', participationMode: 'COMMENT', allowImageAttachments: true },
    program, lottery: defaultTopicLotteryConfig(),
  }
}

export function toggleTopicWizardPlatform(draft: TopicActivityWizardDraft, key: string): TopicActivityWizardDraft {
  const platform = topicWizardPlatforms.find((item) => item.key === key)
  if (!platform) return draft
  const exists = draft.program.entries.some((entry) => entry.platformKey === key)
  const taskId = draft.identity.platformTaskIds[key]
  const entries = exists ? draft.program.entries.filter((entry) => entry.platformKey !== key) : [...draft.program.entries, {
    id: taskId, platformKey: key, platformName: platform.name, title: `${platform.name}活动分享`,
    instructions: `在${platform.name}发布活动相关内容，按参与说明提交有效截图，等待管理员审核。`, materialRequirement: '', minImages: 1, maxImages: 3, points: 1, enabled: true,
    sortOrder: draft.program.entries.length, startsAt: null, endsAt: null, allowResubmit: true,
  }]
  const sourceEntryIds = exists ? draft.lottery.sourceEntryIds.filter((id) => entries.some((entry) => entry.id === id))
    : [...draft.lottery.sourceEntryIds, taskId]
  return { ...draft, program: { ...draft.program, entries,
    medal: { ...draft.program.medal, triggers: draft.program.medal.enabled ? [entries.length ? 'PLATFORM' : 'APPROVED_COMMENT'] : draft.program.medal.triggers },
    platformRewards: { ...draft.program.platformRewards, enabled: entries.length > 0 } },
    lottery: { ...draft.lottery, sourceEntryIds } }
}

export function changeTopicWizardEnd(draft: TopicActivityWizardDraft, endsAt: string): TopicActivityWizardDraft {
  return { ...draft, activity: { ...draft.activity, endsAt: endsAt || null },
    lottery: { ...draft.lottery, eligibilityDeadline: endsAt || null } }
}

export function topicWizardErrors(draft: TopicActivityWizardDraft, step: number): string[] {
  const errors: string[] = []
  const { activity, program, lottery } = draft
  const start = parseActivityDateInput(activity.startsAt), end = parseActivityDateInput(activity.endsAt)
  if (step === 0 || step === 3) {
    if (!activity.title.trim()) errors.push('请填写活动名称')
    if (!activity.description.trim()) errors.push('请填写活动介绍')
    if (!start || !end) errors.push('请填写有效的活动开始和结束时间')
    else if (end <= start) errors.push('活动结束时间必须晚于开始时间')
  }
  if (step === 1 || step === 3) {
    if (!activity.participationRule?.trim()) errors.push('请填写参与说明')
    if (program.entries.length && !activity.allowImageAttachments) errors.push('平台截图任务需要开启图片附件')
    for (const entry of program.entries) {
      if (!entry.title.trim()) errors.push(`${entry.platformName}：请填写任务标题`)
      if (!entry.instructions.trim()) errors.push(`${entry.platformName}：请填写任务要求`)
      if (!Number.isInteger(entry.minImages) || !Number.isInteger(entry.maxImages) || entry.minImages < 1 || entry.maxImages < entry.minImages || entry.maxImages > 20) errors.push(`${entry.platformName}：截图数量需为 1～20 的整数，最多不能小于最少`)
    }
  }
  if (step === 2 || step === 3) {
    for (const entry of program.entries) {
      if (!Number.isInteger(entry.points) || entry.points < 1 || entry.points > 2_000_000_000) errors.push(`${entry.platformName}：现有平台奖励入口要求正整数挂号费，不能为 0`)
    }
    if (program.medal.enabled && !program.medal.badgeId) errors.push('请选择参与奖励勋章')
    if (lottery.enabled) {
      if (!program.platformRewards.enabled || !program.entries.length) errors.push('开启抽奖须先配置指定平台截图任务；普通讨论评论不是当前抽奖资格来源')
      if (!activity.allowImageAttachments) errors.push('开启抽奖须允许图片附件')
      if (!lottery.sourceEntryIds.length || lottery.sourceEntryIds.some((id) => !program.entries.some((entry) => entry.id === id && entry.enabled && entry.minImages >= 1))) errors.push('请选择有效的平台截图任务作为资格来源')
      if (!lottery.prizes.length) errors.push('请至少添加一个奖品')
      for (const prize of lottery.prizes) {
        if (!prize.name.trim()) errors.push('请填写奖品名称')
        if (!Number.isInteger(prize.quantity) || prize.quantity < 1 || prize.quantity > 1000) errors.push('每档奖品数量需为 1～1000 的整数')
      }
      if (lottery.prizes.reduce((total, prize) => total + prize.quantity, 0) > 1000) errors.push('奖品总数不能超过 1000 件')
      const draw = parseActivityDateInput(lottery.drawAt), address = parseActivityDateInput(lottery.addressDeadline)
      if (!end || !draw || !address) errors.push('请填写有效的开奖和收件截止时间')
      else {
        if (draw < end) errors.push('开奖时间不能早于活动结束／资格截止')
        if (address <= draw) errors.push('收件截止必须晚于开奖时间')
      }
    }
  }
  return [...new Set(errors)]
}
