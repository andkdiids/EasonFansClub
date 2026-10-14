import { parseActivityDateInput } from '@/lib/activity'
import { storedActivityImageUrl } from '@/lib/activity-image-url'
import { normalizeTopicActivityV2Program, type TopicActivityV2Program } from '@/lib/topic-activity-v2-config'
import { normalizeTopicLotteryConfig, type TopicLotteryConfig } from '@/lib/topic-activity-v2-lottery-config'
import { TOPIC_ACTIVITY_FORM_VERSION, type TopicActivityFormSchema } from '@/lib/topic-activity-form'
import type { ActivityEditableValues } from '@/lib/activity-validation'
import type { WizardSnapshot } from './TopicActivityWizardSession'
import type { WizardImageSnapshot } from './TopicActivityWizardMedia'
import { restoreWizardSnapshot } from './TopicActivityWizardSession'
import { topicWizardErrors } from './TopicActivityWizardState'

export type WizardActivityPayload = Pick<ActivityEditableValues, 'title' | 'description' | 'coverUrl'> & {
  type: 'TOPIC_ACTIVITY'; status: 'DRAFT'
  startsAt: string | null; endsAt: string | null; participationRule: string | null; participationMode: 'COMMENT'
  allowImageAttachments: boolean; formSchema: TopicActivityFormSchema
  rewardPoints: null; rewardBadgeIds: string[]; rewardGrantMode: 'IMMEDIATE'; rewardGrantAt: null; verificationMode: 'NONE'
}
export type WizardPayloads = {
  activity: WizardActivityPayload; program: { program: TopicActivityV2Program }; lottery: { config: TopicLotteryConfig } | null
}
export type WizardPayloadPreparation = { kind: 'READY'; payloads: WizardPayloads }
  | { kind: 'BLOCKED'; blockers: string[]; preview: WizardPayloads }
const iso = (value: string | null) => value ? parseActivityDateInput(value)?.toISOString() ?? null : null

/** Program-only contract adapter. Lottery and image state never enter the V2 request. */
export function prepareWizardProgramPayload(snapshot: WizardSnapshot): WizardPayloads['program'] {
  const { draft } = restoreWizardSnapshot(snapshot)
  if (draft.activity.type !== 'TOPIC_ACTIVITY' || draft.activity.participationMode !== 'COMMENT') throw new Error('仅支持话题活动的 V2 配置')
  const normalized = normalizeTopicActivityV2Program(draft.program)
  if (!normalized.valid) throw new Error(normalized.message)
  return { program: normalized.value }
}

/** Lottery-only whitelist. Local files must be explicitly removed or already uploaded; never silently omitted. */
export function prepareWizardLotteryPayload(snapshot: WizardSnapshot): WizardPayloads['lottery'] {
  const { draft } = restoreWizardSnapshot(snapshot)
  if (!draft.lottery.enabled) return null
  const { program } = prepareWizardProgramPayload(snapshot)
  if (!program.enabled || !program.platformRewards.enabled || !draft.activity.allowImageAttachments
    || !draft.lottery.sourceEntryIds.length || draft.lottery.sourceEntryIds.some((id) => !program.entries.some((entry) => entry.id === id && entry.enabled && entry.minImages >= 1 && entry.maxImages >= 1))) {
    throw new Error('开启抽奖须使用已保存的有效平台截图任务作为资格来源')
  }
  const errors = topicWizardErrors(draft, 3)
  if (errors.length) throw new Error(errors.join('；'))
  const value = draft.lottery
  const config = normalizeTopicLotteryConfig({ version: value.version, enabled: value.enabled, title: value.title, description: value.description,
    mode: value.mode, drawAt: value.drawAt, eligibilityDeadline: iso(draft.activity.endsAt), addressDeadline: value.addressDeadline,
    publishWinners: value.publishWinners, retentionDays: value.retentionDays, sourceEntryIds: [...value.sourceEntryIds],
    prizes: value.prizes.map((prize) => {
      const image = snapshot.media.prizes[prize.id]
      let imageUrl = prize.imageUrl
      if (image && image.status !== 'EMPTY') {
        if (image.status !== 'UPLOADED' || !image.url || /[?#]/.test(image.url)) throw new Error(`奖品「${prize.name}」图片尚未上传；请移除本地图片后保存`)
        const source = storedActivityImageUrl(image.url)
        imageUrl = source ? `/cos${new URL(source).pathname}` : image.url
      }
      return { id: prize.id, name: prize.name, description: prize.description, imageUrl, quantity: prize.quantity, sortOrder: prize.sortOrder }
    }) })
  return { config }
}

/** Phase 2-A: only the base activity. Future program/prize settings are not submitted or validated here. */
export function prepareWizardActivityPayload(snapshot: WizardSnapshot): WizardActivityPayload {
  const { draft } = restoreWizardSnapshot(snapshot)
  if (draft.activity.type !== 'TOPIC_ACTIVITY' || draft.activity.participationMode !== 'COMMENT') throw new Error('仅支持创建话题活动草稿')
  const errors = [...topicWizardErrors(draft, 0), ...topicWizardErrors(draft, 1)]
  if (errors.length) throw new Error(errors.join('；'))
  const cover = snapshot.media.cover
  if (cover.status !== 'EMPTY' && (cover.status !== 'UPLOADED' || !cover.url || /[?#]/.test(cover.url) || !storedActivityImageUrl(cover.url))) {
    throw new Error('封面尚未上传；本阶段不接入上传，请移除本地封面后创建草稿')
  }
  return {
    type: 'TOPIC_ACTIVITY', status: 'DRAFT', title: draft.activity.title.trim(), description: draft.activity.description.trim(),
    coverUrl: cover.status === 'UPLOADED' ? storedActivityImageUrl(cover.url) : null,
    startsAt: iso(draft.activity.startsAt), endsAt: iso(draft.activity.endsAt), participationRule: draft.activity.participationRule?.trim() || null,
    participationMode: 'COMMENT', allowImageAttachments: draft.activity.allowImageAttachments,
    formSchema: { version: TOPIC_ACTIVITY_FORM_VERSION, fields: [], commentPolicy: { gateMode: 'AFTER_FORM_SUBMIT', commentLimit: 'MULTIPLE' } },
    rewardPoints: null, rewardBadgeIds: [], rewardGrantMode: 'IMMEDIATE', rewardGrantAt: null, verificationMode: 'NONE',
  }
}

/** Contract-specific whitelist. Never includes identity, session state, Files or preview URLs. */
export function prepareWizardPayloads(snapshot: WizardSnapshot): WizardPayloadPreparation {
  const { draft } = restoreWizardSnapshot(snapshot)
  if (draft.activity.type !== 'TOPIC_ACTIVITY' || draft.activity.participationMode !== 'COMMENT') throw new Error('该向导仅支持创建评论审核型话题活动')
  if (draft.lottery.enabled && !draft.program.enabled) throw new Error('必须先启用话题模块，抽奖不能独立于话题参与')
  const errors = topicWizardErrors(draft, 3)
  if (errors.length) throw new Error(errors.join('；'))
  const blockers: string[] = []
  function imageUrl(image: WizardImageSnapshot | undefined, label: string, target: 'cover' | 'prize'): string | null {
    if (!image || image.status === 'EMPTY') return null
    if (image.status !== 'UPLOADED' || !image.url) { blockers.push(`${label}尚未上传或需重新选择`); return null }
    if (/[?#]/.test(image.url) || /^(?:blob|data):/i.test(image.url)) { blockers.push(`${label}不能使用预览或签名地址`); return null }
    if (target === 'cover') {
      const stored = storedActivityImageUrl(image.url)
      if (!stored) blockers.push(`${label}地址不符合活动图片接口`)
      return stored
    }
    // The existing uploader returns media/COS URLs; the prize contract expects public project paths.
    const source = storedActivityImageUrl(image.url)
    const url = source ? `/cos${new URL(source).pathname}` : image.url
    try {
      const checked = normalizeTopicLotteryConfig({ enabled: false, prizes: [{ id: 'validation-only', name: '', quantity: 1, imageUrl: url }] })
      return checked.prizes[0].imageUrl
    } catch { blockers.push(`${label}地址不符合奖品图片接口`); return null }
  }
  const normalized = normalizeTopicActivityV2Program(draft.program)
  if (!normalized.valid) throw new Error(normalized.message)
  const activity: WizardActivityPayload = {
    type: 'TOPIC_ACTIVITY', status: 'DRAFT', title: draft.activity.title.trim(), description: draft.activity.description.trim(),
    coverUrl: imageUrl(snapshot.media.cover, '活动封面', 'cover'), startsAt: iso(draft.activity.startsAt), endsAt: iso(draft.activity.endsAt),
    participationRule: draft.activity.participationRule?.trim() || null, participationMode: 'COMMENT', allowImageAttachments: draft.activity.allowImageAttachments,
    formSchema: { version: TOPIC_ACTIVITY_FORM_VERSION, fields: [], commentPolicy: { gateMode: 'AFTER_FORM_SUBMIT', commentLimit: 'MULTIPLE' } },
    rewardPoints: null, rewardBadgeIds: [], rewardGrantMode: 'IMMEDIATE', rewardGrantAt: null, verificationMode: 'NONE',
  }
  const config = draft.lottery.enabled ? normalizeTopicLotteryConfig({ ...draft.lottery, eligibilityDeadline: activity.endsAt,
    prizes: draft.lottery.prizes.map((prize) => ({ id: prize.id, name: prize.name, description: prize.description,
      quantity: prize.quantity, sortOrder: prize.sortOrder, imageUrl: imageUrl(snapshot.media.prizes[prize.id], `奖品「${prize.name}」图片`, 'prize') })) }) : null
  const payloads = { activity, program: { program: normalized.value }, lottery: config ? { config } : null }
  return blockers.length ? { kind: 'BLOCKED', blockers, preview: payloads } : { kind: 'READY', payloads }
}
export function requireReadyWizardPayloads(result: WizardPayloadPreparation): WizardPayloads {
  if (result.kind !== 'READY') throw new Error('图片处理尚未完成，禁止将预览配置作为接口提交内容')
  return structuredClone(result.payloads)
}
