import { parseActivityDateInput, type ActivityView } from '@/lib/activity'
import { formatBeijingDateTimeInput } from '@/lib/registration-availability'
import { normalizeTopicActivityV2Program, createDefaultTopicActivityV2Program, type TopicActivityV2Program } from '@/lib/topic-activity-v2-config'
import { defaultTopicLotteryConfig, normalizeTopicLotteryConfig, type TopicLotteryConfig } from '@/lib/topic-activity-v2-lottery-config'
import { storedActivityImageUrl } from '@/lib/activity-image-url'
import { createTopicWizardDraft, type TopicActivityWizardDraft } from './TopicActivityWizardState'
import { createWizardMedia, type WizardMedia, type WizardImage } from './TopicActivityWizardMedia'
import { canonicalWizardValue } from './TopicActivityWizardProgramSave'
import { topicActivityTestDirty } from '@/lib/topic-activity-test-presentation'

export type WizardEditActivitySnapshot = {
  id: string
  type: string
  status: string
  title: string
  description: string
  coverUrl: string | null
  startsAt: string | null
  endsAt: string | null
  participationRule: string | null
  participationMode: string
  allowImageAttachments: boolean
  rewardGrantMode?: 'IMMEDIATE' | 'SCHEDULED'
  rewardGrantAt?: string | null
}
export type TopicWizardEditBaseline = {
  activity: WizardEditActivitySnapshot
  program: TopicActivityV2Program
  lottery: TopicLotteryConfig
  lotteryMeta: { configLocked: boolean; addressEncryptionReady: boolean }
  testParticipants: number
}
export type TopicWizardEditInitialState = { baseline: TopicWizardEditBaseline; draft: TopicActivityWizardDraft; media: WizardMedia }

export type EditStage = 'ACTIVITY' | 'PROGRAM' | 'LOTTERY'
export type EditPendingVerification =
  | { stage: 'ACTIVITY'; expected: WizardEditActivitySnapshot; changedFields: string[] }
  | { stage: 'PROGRAM'; expected: TopicActivityV2Program }
  | { stage: 'LOTTERY'; expected: TopicLotteryConfig }
export type EditSaveResult = {
  status: 'NO_CHANGES' | 'SAVED' | 'PARTIAL' | 'CONFLICT' | 'BLOCKED' | 'UNKNOWN'
  baseline: TopicWizardEditBaseline
  completed: EditStage[]
  message: string
  pendingVerification?: EditPendingVerification
}

export type WizardEditTransport = (path: string, init: RequestInit) => Promise<Response>
const request: WizardEditTransport = (path, init) => fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
const clone = <T,>(value: T): T => structuredClone(value)
const canonical = canonicalWizardValue
const nullableString = (value: unknown) => typeof value === 'string' && value ? value : null
const isoDate = (value: string | null) => value ? parseActivityDateInput(value)?.toISOString() ?? null : null
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function dateInput(value: unknown) {
  if (typeof value !== 'string' || !value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? formatBeijingDateTimeInput(date) || null : null
}
function activitySnapshot(value: unknown, expectedId: string): WizardEditActivitySnapshot {
  const row = record(value)
  if (!row || row.id !== expectedId || row.type !== 'TOPIC_ACTIVITY' || !['DRAFT', 'PUBLISHED', 'CANCELLED'].includes(String(row.status))) throw new Error('活动读取结果与当前话题活动不匹配')
  return {
    id: expectedId, type: 'TOPIC_ACTIVITY', status: String(row.status), title: typeof row.title === 'string' ? row.title : '',
    description: typeof row.description === 'string' ? row.description : '', coverUrl: nullableString(row.coverUrl),
    startsAt: nullableString(row.startsAt), endsAt: nullableString(row.endsAt), participationRule: nullableString(row.participationRule),
    participationMode: typeof row.participationMode === 'string' ? row.participationMode : 'COMMENT', allowImageAttachments: row.allowImageAttachments === true,
    rewardGrantMode: row.rewardGrantMode === 'SCHEDULED' ? 'SCHEDULED' : 'IMMEDIATE', rewardGrantAt: nullableString(row.rewardGrantAt),
  }
}
function programValue(value: unknown) {
  if (value === null || value === undefined) return createDefaultTopicActivityV2Program()
  const normalized = normalizeTopicActivityV2Program(value)
  if (!normalized.valid) throw new Error(`话题配置无法安全编辑：${normalized.message}`)
  return normalized.value
}
function lotteryValue(value: unknown) {
  try { return normalizeTopicLotteryConfig(value ?? defaultTopicLotteryConfig()) }
  catch (error) { throw new Error(`抽奖配置无法安全编辑：${error instanceof Error ? error.message : '格式无效'}`) }
}
function imageFromUrl(url: string | null): WizardImage {
  return { selectionId: null, file: null, status: url ? 'UPLOADED' : 'EMPTY', url, error: null, uploadRequestId: null, fileInfo: null }
}

export function topicWizardEditInitialState(activityData: unknown, programData: unknown, lotteryData: unknown, activityId: string): TopicWizardEditInitialState {
  const detail = record(activityData), activity = activitySnapshot(detail?.activity, activityId)
  const v2 = record(programData), lotteryView = record(lotteryData)
  const program = programValue(v2?.program)
  const lottery = lotteryValue(lotteryView?.config)
  const statistics = record(v2?.statistics)
  const baseline: TopicWizardEditBaseline = {
    activity, program, lottery,
    lotteryMeta: { configLocked: lotteryView?.configLocked === true, addressEncryptionReady: lotteryView?.addressEncryptionReady === true },
    testParticipants: Number.isSafeInteger(statistics?.testParticipants) && Number(statistics?.testParticipants) >= 0 ? Number(statistics?.testParticipants) : 0,
  }
  const draft = createTopicWizardDraft()
  draft.activity = {
    ...draft.activity, type: 'TOPIC_ACTIVITY', title: activity.title, description: activity.description, coverUrl: activity.coverUrl,
    startsAt: dateInput(activity.startsAt), endsAt: dateInput(activity.endsAt), participationRule: activity.participationRule,
    participationMode: activity.participationMode as ActivityView['participationMode'], allowImageAttachments: activity.allowImageAttachments,
    rewardGrantMode: activity.rewardGrantMode, rewardGrantAt: dateInput(activity.rewardGrantAt),
  }
  draft.program = clone(program)
  draft.lottery = clone(lottery)
  draft.identity.platformTaskIds = Object.fromEntries(draft.program.entries.map((entry) => [entry.platformKey, entry.id]))
  const media = createWizardMedia()
  media.cover = imageFromUrl(activity.coverUrl)
  for (const prize of lottery.prizes) media.prizes[prize.id] = imageFromUrl(prize.imageUrl)
  return { baseline, draft, media }
}

export type WizardEditChanges = {
  activityPatch: Record<string, unknown>
  program: TopicActivityV2Program
  lottery: TopicLotteryConfig
  programChanged: boolean
  lotteryChanged: boolean
  testDirty: ReturnType<typeof topicActivityTestDirty>
}

export function getTopicWizardEditChanges(baseline: TopicWizardEditBaseline, draft: TopicActivityWizardDraft, media: WizardMedia): WizardEditChanges {
  const activityPatch: Record<string, unknown> = {}
  const activityFields: Array<{ key: keyof WizardEditActivitySnapshot; raw: unknown; value: unknown }> = [
    { key: 'title', raw: draft.activity.title, value: draft.activity.title.trim() },
    { key: 'description', raw: draft.activity.description, value: draft.activity.description.trim() },
    { key: 'coverUrl', raw: draft.activity.coverUrl, value: draft.activity.coverUrl },
    { key: 'startsAt', raw: draft.activity.startsAt, value: isoDate(draft.activity.startsAt) },
    { key: 'endsAt', raw: draft.activity.endsAt, value: isoDate(draft.activity.endsAt) },
    { key: 'participationRule', raw: draft.activity.participationRule ?? '', value: draft.activity.participationRule?.trim() || null },
    { key: 'allowImageAttachments', raw: draft.activity.allowImageAttachments, value: draft.activity.allowImageAttachments },
    { key: 'rewardGrantMode', raw: draft.activity.rewardGrantMode ?? 'IMMEDIATE', value: draft.activity.rewardGrantMode ?? 'IMMEDIATE' },
    { key: 'rewardGrantAt', raw: draft.activity.rewardGrantAt ?? null, value: draft.activity.rewardGrantMode === 'SCHEDULED' ? isoDate(draft.activity.rewardGrantAt ?? null) : null },
  ]
  for (const field of activityFields) {
    const before = baseline.activity[field.key]
    const baselineInput = field.key === 'startsAt' || field.key === 'endsAt' || field.key === 'rewardGrantAt' ? dateInput(before) : field.key === 'participationRule' ? before || '' : field.key === 'rewardGrantMode' ? before ?? 'IMMEDIATE' : before
    // Compare displayed form values first so untouched legacy whitespace or seconds are never normalized away.
    if (canonical(field.raw) !== canonical(baselineInput)) activityPatch[field.key] = field.value
  }
  // Editing nullable legacy fields is not creation. Validate only changed inputs.
  if (Object.hasOwn(activityPatch, 'title') && !draft.activity.title.trim()) throw new Error('请填写活动名称')
  if (Object.hasOwn(activityPatch, 'rewardGrantMode') || Object.hasOwn(activityPatch, 'rewardGrantAt')) {
    if (draft.activity.rewardGrantMode === 'SCHEDULED' && !parseActivityDateInput(draft.activity.rewardGrantAt)) throw new Error('请填写有效的统一发奖时间（北京时间）')
    activityPatch.rewardGrantAt = draft.activity.rewardGrantMode === 'SCHEDULED' ? isoDate(draft.activity.rewardGrantAt ?? null) : null
  }
  for (const [key, label] of [['startsAt', '开始'], ['endsAt', '结束']] as const) {
    if (Object.hasOwn(activityPatch, key) && draft.activity[key] && !parseActivityDateInput(draft.activity[key])) throw new Error(`活动${label}时间格式不正确`)
  }
  if (Object.hasOwn(activityPatch, 'startsAt') || Object.hasOwn(activityPatch, 'endsAt')) {
    const start = parseActivityDateInput(draft.activity.startsAt), end = parseActivityDateInput(draft.activity.endsAt)
    if (start && end && end <= start) throw new Error('活动结束时间必须晚于开始时间')
  }

  const programResult = normalizeTopicActivityV2Program(draft.program)
  if (!programResult.valid) throw new Error(programResult.message)
  const program = programResult.value
  const testDirty = topicActivityTestDirty(baseline.program.test, program.test)
  if (baseline.testParticipants > 0 && testDirty.TEST_STRUCTURE_DIRTY
    && program.test.id === baseline.program.test.id && program.test.version <= baseline.program.test.version) {
    program.test.version = baseline.program.test.version + 1
  }
  const lotteryConfig = normalizeTopicLotteryConfig({ ...draft.lottery, prizes: draft.lottery.prizes.map((prize) => {
    const image = media.prizes[prize.id]
    if (image && ['SELECTED', 'UPLOADING', 'FAILED', 'NEEDS_RESELECT'].includes(image.status)) throw new Error(`奖品「${prize.name || '未命名'}」图片尚未上传完成`)
    let imageUrl = prize.imageUrl
    if (image?.status === 'UPLOADED' && image.url) {
      if (/[?#]/.test(image.url)) throw new Error(`奖品「${prize.name || '未命名'}」图片地址无效`)
      const source = storedActivityImageUrl(image.url)
      imageUrl = source ? `/cos${new URL(source).pathname}` : image.url
    } else if (image?.status === 'EMPTY') imageUrl = prize.imageUrl
    return { ...prize, imageUrl }
  }) })
  return {
    activityPatch,
    program,
    lottery: lotteryConfig,
    programChanged: canonical(program) !== canonical(baseline.program),
    lotteryChanged: canonical(lotteryConfig) !== canonical(baseline.lottery),
    testDirty,
  }
}

async function getJson(transport: WizardEditTransport, path: string) {
  const response = await transport(path, { method: 'GET' })
  const value = await response.json().catch(() => null)
  if (!response.ok) throw new Error(record(value)?.message as string || `读取失败（${response.status}）`)
  return value
}
function editPath(activityId: string, stage: EditStage) {
  const base = `/api/admin/activities/${encodeURIComponent(activityId)}`
  return stage === 'ACTIVITY' ? base : stage === 'PROGRAM' ? `${base}/v2` : `${base}/v2/lottery`
}
function moduleValue(data: unknown, stage: EditStage, activityId: string): WizardEditActivitySnapshot | TopicActivityV2Program | TopicLotteryConfig {
  const row = record(data)
  if (stage === 'ACTIVITY') return activitySnapshot(row?.activity, activityId)
  if (stage === 'PROGRAM') return programValue(row?.program)
  return lotteryValue(row?.config)
}
function readModule(value: WizardEditActivitySnapshot | TopicActivityV2Program | TopicLotteryConfig, stage: EditStage, baseline: TopicWizardEditBaseline) {
  if (stage === 'ACTIVITY') return { ...baseline, activity: value as WizardEditActivitySnapshot }
  if (stage === 'PROGRAM') return { ...baseline, program: value as TopicActivityV2Program }
  return { ...baseline, lottery: value as TopicLotteryConfig }
}
function expectedActivity(baseline: WizardEditActivitySnapshot, patch: Record<string, unknown>): WizardEditActivitySnapshot {
  return { ...baseline, ...patch } as WizardEditActivitySnapshot
}
function matchesExpected(actual: WizardEditActivitySnapshot | TopicActivityV2Program | TopicLotteryConfig, expected: EditPendingVerification) {
  if (expected.stage === 'ACTIVITY') {
    const row = actual as WizardEditActivitySnapshot
    return ['id', 'type', 'status', 'title', 'description', 'coverUrl', 'startsAt', 'endsAt', 'participationRule', 'participationMode', 'allowImageAttachments', 'rewardGrantMode', 'rewardGrantAt']
      .every((key) => canonical((row as unknown as Record<string, unknown>)[key]) === canonical((expected.expected as unknown as Record<string, unknown>)[key]))
  }
  return canonical(actual) === canonical(expected.expected)
}
function conflictFor(stage: EditStage, current: WizardEditActivitySnapshot | TopicActivityV2Program | TopicLotteryConfig, baseline: TopicWizardEditBaseline, changedFields?: string[]) {
  if (stage === 'ACTIVITY') {
    const row = current as WizardEditActivitySnapshot
    const fields = ['id', 'type', 'status', ...(changedFields || [])]
    return fields.some((key) => canonical((row as unknown as Record<string, unknown>)[key]) !== canonical((baseline.activity as unknown as Record<string, unknown>)[key]))
  }
  return canonical(current) !== canonical(stage === 'PROGRAM' ? baseline.program : baseline.lottery)
}
function editMessage(value: unknown, fallback: string) { return (record(value)?.message as string) || fallback }
function assertActivityIdentity(data: unknown, activityId: string, baseline: TopicWizardEditBaseline) {
  const row = record(record(data)?.activity)
  if (row?.id !== activityId || row.type !== 'TOPIC_ACTIVITY' || row.status !== baseline.activity.status) {
    throw new Error('活动身份或状态已变化；为避免误改，本次停止保存。')
  }
}

export async function saveTopicWizardEdits(input: {
  activityId: string
  baseline: TopicWizardEditBaseline
  draft: TopicActivityWizardDraft
  media: WizardMedia
  pendingVerification?: EditPendingVerification
  transport?: WizardEditTransport
}): Promise<EditSaveResult> {
  const transport = input.transport || request
  const id = input.activityId
  let baseline = clone(input.baseline)
  const completed: EditStage[] = []
  if (baseline.activity.id !== id || baseline.activity.type !== 'TOPIC_ACTIVITY' || baseline.activity.status === 'CANCELLED') {
    return { status: 'BLOCKED', baseline, completed, message: '活动身份或状态不允许通过简易向导修改；高级设置保持可用。' }
  }
  let changes: WizardEditChanges
  try { changes = getTopicWizardEditChanges(baseline, input.draft, input.media) }
  catch (error) { return { status: 'BLOCKED', baseline, completed, message: error instanceof Error ? error.message : '候选配置无效' } }

  if (input.pendingVerification) {
    const pending = input.pendingVerification
    try {
      if (pending.stage === 'PROGRAM' || pending.stage === 'LOTTERY') assertActivityIdentity(await getJson(transport, editPath(id, 'ACTIVITY')), id, baseline)
      const actual = moduleValue(await getJson(transport, editPath(id, pending.stage)), pending.stage, id)
      if (!matchesExpected(actual, pending)) return { status: 'UNKNOWN', baseline, completed, message: `${pending.stage} 的上次请求结果仍无法确认；本次只读核对，没有重发写入。`, pendingVerification: pending }
      baseline = readModule(actual, pending.stage, baseline)
      return { status: 'SAVED', baseline, completed: [pending.stage], message: `${pending.stage} 已通过只读回读确认；本次没有重发写入。` }
    } catch {
      return { status: 'UNKNOWN', baseline, completed, message: `${pending.stage} 的上次请求结果不明；本次只尝试读取，没有重发写入。`, pendingVerification: pending }
    }
  }

  const stages: Array<{ stage: EditStage; changed: boolean; changedFields?: string[]; body?: unknown; expected?: WizardEditActivitySnapshot | TopicActivityV2Program | TopicLotteryConfig }> = []
  if (Object.keys(changes.activityPatch).length) stages.push({ stage: 'ACTIVITY', changed: true, changedFields: Object.keys(changes.activityPatch), body: changes.activityPatch, expected: expectedActivity(baseline.activity, changes.activityPatch) })
  if (changes.programChanged) {
    stages.push({ stage: 'PROGRAM', changed: true, body: { program: changes.program }, expected: changes.program })
  }
  if (changes.lotteryChanged) {
    if (baseline.lotteryMeta.configLocked) return { status: 'BLOCKED', baseline, completed, message: '抽奖资格或开奖名单已锁定，现有规则禁止修改。' }
    if (changes.lottery.enabled && !baseline.lotteryMeta.addressEncryptionReady) return { status: 'BLOCKED', baseline, completed, message: '中奖收件资料加密配置尚未就绪，不能启用实物抽奖。' }
    stages.push({ stage: 'LOTTERY', changed: true, body: { config: changes.lottery }, expected: changes.lottery })
  }
  if (!stages.length) return { status: 'NO_CHANGES', baseline, completed, message: '没有检测到需要保存的修改；未发送写入请求。' }

  for (const item of stages) {
    const path = editPath(id, item.stage)
    let current: WizardEditActivitySnapshot | TopicActivityV2Program | TopicLotteryConfig
    let currentBody: unknown
    let expected = item.expected
    try {
      currentBody = await getJson(transport, path)
      // The V2 activity summary does not contain type. Use the existing canonical detail route.
      if (item.stage === 'PROGRAM' || item.stage === 'LOTTERY') assertActivityIdentity(await getJson(transport, editPath(id, 'ACTIVITY')), id, baseline)
      if (item.stage === 'PROGRAM') {
        const summary = record(record(currentBody)?.activity)
        if (summary?.id !== id || summary.status !== baseline.activity.status) throw new Error('话题配置回包的活动身份或状态不匹配；已停止保存。')
      }
      current = moduleValue(currentBody, item.stage, id)
    }
    catch (error) { return { status: completed.length ? 'PARTIAL' : 'BLOCKED', baseline, completed, message: `${item.stage} 保存前读取失败：${error instanceof Error ? error.message : '读取失败'}` } }
    if (conflictFor(item.stage, current, baseline, item.changedFields)) return { status: completed.length ? 'PARTIAL' : 'CONFLICT', baseline, completed, message: `${item.stage} 配置已被其他管理员修改；为避免覆盖，本次停止保存。请重新读取后确认差异。` }
    if (item.stage === 'ACTIVITY') expected = expectedActivity(current as WizardEditActivitySnapshot, item.body as Record<string, unknown>)
    const liveLotteryView = item.stage === 'LOTTERY' ? record(currentBody) : null
    if (item.stage === 'LOTTERY' && (liveLotteryView?.configLocked === true || liveLotteryView?.draw != null
      || (Array.isArray(liveLotteryView?.winners) && liveLotteryView.winners.length > 0))) {
      return { status: completed.length ? 'PARTIAL' : 'BLOCKED', baseline, completed, message: '抽奖配置已出现参与或开奖记录并被服务端锁定；未发送抽奖配置写入。' }
    }
    if (item.stage === 'LOTTERY' && changes.lottery.enabled && liveLotteryView?.addressEncryptionReady !== true) {
      return { status: completed.length ? 'PARTIAL' : 'BLOCKED', baseline, completed, message: '抽奖收件加密配置当前未就绪；未发送抽奖配置写入。' }
    }
    if (item.stage === 'PROGRAM') {
      const stats = record(currentBody)?.statistics
      const testParticipants = Number(record(stats)?.testParticipants)
      const liveProgram = current as TopicActivityV2Program
      const candidate = (item.body as { program: TopicActivityV2Program }).program
      const structureChanged = topicActivityTestDirty(liveProgram.test, candidate.test).TEST_STRUCTURE_DIRTY
      if (Number.isSafeInteger(testParticipants) && testParticipants > 0 && candidate.test.id === liveProgram.test.id) {
        if (structureChanged && candidate.test.version <= liveProgram.test.version) candidate.test.version = liveProgram.test.version + 1
        else if (candidate.test.version < liveProgram.test.version) candidate.test.version = liveProgram.test.version
      }
      item.body = { program: candidate }
      item.expected = candidate
      expected = candidate
    }

    let response: Response
    try {
      response = await transport(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.body) })
    } catch {
      const pending: EditPendingVerification = item.stage === 'ACTIVITY'
        ? { stage: item.stage, expected: expected as WizardEditActivitySnapshot, changedFields: item.changedFields || [] }
        : item.stage === 'PROGRAM' ? { stage: item.stage, expected: expected as TopicActivityV2Program } : { stage: item.stage, expected: expected as TopicLotteryConfig }
      try {
        const after = moduleValue(await getJson(transport, path), item.stage, id)
        if (matchesExpected(after, pending)) { baseline = readModule(after, item.stage, baseline); completed.push(item.stage); continue }
      } catch { /* preserve the unknown-write marker */ }
      return { status: 'UNKNOWN', baseline, completed, message: `${item.stage} 写入结果不明；已停止后续写入，只允许再次 GET 核验。`, pendingVerification: pending }
    }
    const responseData = await response.json().catch(() => null)
    if (!response.ok && response.status < 500) return { status: completed.length ? 'PARTIAL' : 'BLOCKED', baseline, completed, message: `${item.stage} 保存失败：${editMessage(responseData, `服务器返回 ${response.status}`)}` }
    const pending: EditPendingVerification = item.stage === 'ACTIVITY'
      ? { stage: item.stage, expected: expected as WizardEditActivitySnapshot, changedFields: item.changedFields || [] }
      : item.stage === 'PROGRAM' ? { stage: item.stage, expected: expected as TopicActivityV2Program } : { stage: item.stage, expected: expected as TopicLotteryConfig }
    try {
      const after = moduleValue(await getJson(transport, path), item.stage, id)
      if (matchesExpected(after, pending)) { baseline = readModule(after, item.stage, baseline); completed.push(item.stage); continue }
      return { status: 'UNKNOWN', baseline, completed, message: `${item.stage} 回读与候选不一致；已停止后续写入，请检查服务器状态。`, pendingVerification: pending }
    } catch {
      return { status: 'UNKNOWN', baseline, completed, message: `${item.stage} 写入后回读失败；已停止后续写入，只允许 GET 核验。`, pendingVerification: pending }
    }
  }
  return { status: 'SAVED', baseline, completed, message: `修改已保存并回读确认：${completed.map((stage) => ({ ACTIVITY: '活动信息', PROGRAM: '参与与测试规则', LOTTERY: '抽奖配置' })[stage]).join('、')}。` }
}
